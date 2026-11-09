-- Roleta: 1 giro por dia pra quem já fez pelo menos 1 depósito (sem precisar apostar no dia).
-- Rodadas grátis nativas: a PlayFiver libera o pacote no jogo (/free_bonus), com a aposta travada pelo jogo;
-- o saldo só volta a ser usado quando o pacote acaba.

alter table public.user_rewards add column if not exists pf_granted_at timestamptz;
alter table public.user_rewards add column if not exists pf_grant_msg text;

create or replace function public._has_deposit(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.transactions where user_id = p_user and type = 'deposit' and status = 'done')
$$;

create or replace function public.wheel_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid(); v_dep boolean := false; s public.wheel_spins;
begin
  if v_user is not null then
    v_dep := public._has_deposit(v_user);
    select * into s from public.wheel_spins where user_id = v_user and day = public._today();
  end if;
  return jsonb_build_object('on', coalesce((public._setting('wheel_on'))::text::boolean, true),
    'prizes', (select jsonb_agg(e->>'label' order by o) from jsonb_array_elements(public._setting('wheel_prizes')) with ordinality t(e, o)),
    'logged', v_user is not null, 'dep', v_dep, 'spun', s.id is not null, 'idx', s.idx, 'label', s.label);
end $$;

create or replace function public.wheel_spin() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_pr jsonb := public._setting('wheel_prizes');
  v_tot numeric; v_r numeric; v_acc numeric := 0; v_idx int; e jsonb; o bigint; v_rw bigint; l public.user_limits;
begin
  if not coalesce((public._setting('wheel_on'))::text::boolean, true) then raise exception 'A roleta está desligada no momento'; end if;
  l := public._limits(v_user);
  if l.self_excluded_until > now() then raise exception 'Conta pausada'; end if;
  perform 1 from public.profiles where id = v_user for update;
  if exists (select 1 from public.wheel_spins where user_id = v_user and day = public._today()) then raise exception 'Você já girou hoje. Volte amanhã!'; end if;
  if not public._has_deposit(v_user) then raise exception 'Faça seu primeiro depósito para liberar a roleta'; end if;
  select sum((x->>'w')::numeric) into v_tot from jsonb_array_elements(v_pr) x;
  v_r := random() * v_tot;
  for e, o in select x, n from jsonb_array_elements(v_pr) with ordinality t(x, n) loop
    v_acc := v_acc + (e->>'w')::numeric;
    if v_r < v_acc then v_idx := o - 1; exit; end if;
  end loop;
  if v_idx is null then v_idx := jsonb_array_length(v_pr) - 1; end if;
  e := v_pr->v_idx;
  if e->>'kind' in ('freebet','freespins') then
    v_rw := public._grant_reward(v_user, e->>'kind', (e->>'value')::numeric, e->>'label', 'roleta:' || public._today());
  end if;
  insert into public.wheel_spins (user_id, day, idx, label, reward_id) values (v_user, public._today(), v_idx, e->>'label', v_rw);
  return jsonb_build_object('idx', v_idx, 'label', e->>'label', 'kind', e->>'kind', 'reward', v_rw);
end $$;

create or replace function public._pf_free_credit(p_user uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(spins_left * amount), 0) from public.user_rewards
   where user_id = p_user and kind = 'freespins' and status = 'em_uso' and spins_left > 0 and expires_at > now()
     and pf_granted_at is null
$$;

CREATE OR REPLACE FUNCTION public.pf_tx(p jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  s jsonb := coalesce(p->'slot', '{}'::jsonb);
  v_user uuid; v_txn text := s->>'txn_id'; v_round text := s->>'round_id';
  v_bet numeric := round(coalesce((s->>'bet')::numeric, 0), 2);
  v_win numeric := round(coalesce((s->>'win')::numeric, 0), 2);
  v_game text := coalesce(s->>'game_code', ''); o public.casino_tx; r public.user_rewards; v_free bigint;
  v_nat boolean := jsonb_typeof(s->'free_rounds') in ('object','array') or s->>'free_rounds' = 'true'
    or (jsonb_typeof(s->'free_rounds') = 'number' and (s->>'free_rounds')::numeric > 0);
begin
  select id into v_user from public.profiles where id::text = p->>'user_code';
  if v_user is null then raise exception 'Usuário não encontrado'; end if;
  if v_txn is null or v_txn = '' then raise exception 'txn_id ausente'; end if;
  if v_bet < 0 or v_win < 0 then raise exception 'Valor inválido'; end if;

  if p->>'type' = 'Refund' then
    if exists (select 1 from public.casino_tx where txn_id = 'refund:' || v_txn) then
      return (select balance from public.profiles where id = v_user) + public._pf_free_credit(v_user);
    end if;
    select * into o from public.casino_tx
     where user_id = v_user and kind = 'WinBet' and not refunded and (txn_id = v_txn or (v_round is not null and round_id = v_round))
     order by (txn_id = v_txn) desc, id desc limit 1 for update;
    if found then
      update public.casino_tx set refunded = true where id = o.id;
      if o.free_reward is not null then
        if o.win > 0 then perform public._move(v_user, -o.win, 'refund', 'Cassino: reembolso rodada grátis ' || coalesce(o.game_code, '')); end if;
        update public.user_rewards set spins_left = spins_left + 1, won = greatest(0, won - o.win), status = case when status = 'usado' then 'em_uso' else status end
         where id = o.free_reward;
      elsif o.bet - o.win <> 0 then perform public._move(v_user, o.bet - o.win, 'refund', 'Cassino: reembolso ' || coalesce(o.game_code, '')); end if;
    end if;
    insert into public.casino_tx (user_id, txn_id, round_id, kind, game_code, provider, bet, win, raw)
    values (v_user, 'refund:' || v_txn, v_round, 'Refund', v_game, s->>'provider_code', coalesce(o.bet, 0), coalesce(o.win, 0), p - 'agent_secret');
    return (select balance from public.profiles where id = v_user) + public._pf_free_credit(v_user);
  end if;

  if exists (select 1 from public.casino_tx where txn_id = v_txn) then
    return (select balance from public.profiles where id = v_user) + public._pf_free_credit(v_user);
  end if;
  -- rodada grátis: liberada na PlayFiver (/free_bonus) → a rodada vem marcada (free_rounds) ou sem aposta;
  -- sem liberação nativa vale o jeito antigo (aposta até o valor da rodada). Não desconta do saldo e o ganho (até o teto) vai sem rollover
  if v_bet > 0 or v_nat then
    select u.* into r from public.user_rewards u join public.casino_catalog c on c.id = u.game_id
     where u.user_id = v_user and u.kind = 'freespins' and u.status = 'em_uso' and u.spins_left > 0 and u.expires_at > now()
       and c.pf_code = v_game
       and (case when u.pf_granted_at is not null then v_nat or v_bet = 0 else v_bet > 0 and v_bet <= u.amount end)
     order by u.id limit 1 for update of u;
    if found then
      v_free := r.id;
      v_win := greatest(0, least(v_win, coalesce(r.max_win, 1e12) - r.won));
      update public.user_rewards set spins_left = spins_left - 1, won = won + v_win,
        status = case when spins_left - 1 <= 0 then 'usado' else status end, used_at = case when spins_left - 1 <= 0 then now() end
       where id = r.id;
      if v_win > 0 then perform public._move(v_user, v_win, 'casino_win', 'Rodada grátis: ' || coalesce(r.game_name, v_game)); end if;
      v_bet := 0;
    end if;
  end if;
  if v_free is null and v_nat then v_bet := 0; end if;
  if v_free is null then
    if v_bet > 0 then perform public._move(v_user, -v_bet, 'casino_bet', 'Cassino: ' || v_game); end if;
    if v_win > 0 then perform public._move(v_user, v_win, 'casino_win', 'Cassino: ' || v_game); end if;
  end if;
  insert into public.casino_tx (user_id, txn_id, round_id, kind, game_code, provider, bet, win, raw, free_reward)
  values (v_user, v_txn, v_round, 'WinBet', v_game, s->>'provider_code', v_bet, v_win, p - 'agent_secret', v_free);
  return (select balance from public.profiles where id = v_user) + public._pf_free_credit(v_user);
end $function$;

-- rodadas grátis 25% → 30%, tirando 5% do "Não foi dessa vez" (55% → 50%)
update public.settings set value = '[{"label":"Não foi dessa vez","kind":"none","w":17.5},
  {"label":"10 rodadas grátis","kind":"freespins","value":10,"w":15},
  {"label":"Não foi dessa vez","kind":"none","w":17.5},
  {"label":"Aposta grátis R$ 2","kind":"freebet","value":2,"w":12},
  {"label":"Não foi dessa vez","kind":"none","w":15},
  {"label":"10 rodadas grátis","kind":"freespins","value":10,"w":15},
  {"label":"Aposta grátis R$ 5","kind":"freebet","value":5,"w":6},
  {"label":"Aposta grátis R$ 20","kind":"freebet","value":20,"w":2}]'::jsonb
 where key = 'wheel_prizes';

revoke execute on function public._has_deposit(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
