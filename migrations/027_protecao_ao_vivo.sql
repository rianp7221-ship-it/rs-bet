-- Proteção ao vivo: espera com nova conferência nas apostas ao vivo, limites e liga/desliga do cashout ao vivo
insert into public.settings (key, value, label) values
  ('live_cashout_enabled', 'true', 'Cashout ao vivo ligado (true/false)'),
  ('live_cashout_max', '0', 'Cashout ao vivo: valor máximo por bilhete (R$, 0 = sem limite)'),
  ('live_bet_max_stake', '0', 'Aposta ao vivo: valor máximo por bilhete (R$, 0 = sem limite)'),
  ('live_bet_delay', '7', 'Aposta ao vivo: espera antes de confirmar (segundos)'),
  ('odds_jump_pct', '20', 'Trava ao vivo quando uma odd salta mais que (%) entre duas leituras (0 = desligado)')
on conflict (key) do nothing;

create table if not exists public.bet_requests (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  selections jsonb not null,
  stake numeric not null,
  total_odd numeric not null,
  scores jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','placed','rejected')),
  reason text, bet_id bigint,
  created_at timestamptz not null default now(), done_at timestamptz
);
alter table public.bet_requests enable row level security;
drop policy if exists bet_requests_read on public.bet_requests;
create policy bet_requests_read on public.bet_requests for select using (user_id = auth.uid() or public.has_perm('sports.view'));

-- odd total e placar dos jogos do pedido (sem cobrar nada)
create or replace function public._bet_quote(p_selections jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_live boolean := false; v_scores jsonb := '{}';
begin
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_m from public.matches where id = (v_sel->>'match_id')::bigint;
    if not found or v_m.status not in ('open','live') then return jsonb_build_object('error', 'Jogo indisponível para apostas'); end if;
    if public._suspension(v_m) is not null then
      return jsonb_build_object('error', format('Apostas suspensas em %s x %s (%s)', v_m.home, v_m.away, public._suspension(v_m)));
    end if;
    v_odd := public._sel_odd(v_m, coalesce(v_sel->>'market', '1x2'), v_sel->>'pick');
    if v_odd is null or v_odd <= 1 then return jsonb_build_object('error', format('Palpite indisponível em %s x %s', v_m.home, v_m.away)); end if;
    v_total := v_total * v_odd;
    v_live := v_live or v_m.status = 'live' or v_m.starts_at <= now();
    v_scores := v_scores || jsonb_build_object(v_m.id::text, coalesce(v_m.score_home, 0) + coalesce(v_m.score_away, 0));
  end loop;
  return jsonb_build_object('total', round(v_total, 2), 'live', v_live, 'scores', v_scores);
end $$;

-- pré-jogo: aposta na hora; ao vivo: guarda o pedido e o jogador confirma depois da espera
create or replace function public.place_bet_request(p_selections jsonb, p_stake numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_q jsonb := public._bet_quote(p_selections); v_id bigint;
  v_max numeric := coalesce((public._setting('live_bet_max_stake'))::text::numeric, 0);
  v_wait int := greatest(coalesce((public._setting('live_bet_delay'))::text::int, 7), 3);
begin
  if v_q ? 'error' then raise exception '%', v_q->>'error'; end if;
  if not (v_q->>'live')::boolean then return jsonb_build_object('bet', public.place_bet(p_selections, p_stake)); end if;
  if p_stake is null or p_stake < 1 then raise exception 'Aposta mínima: R$ 1,00'; end if;
  if v_max > 0 and p_stake > v_max then raise exception 'Aposta máxima ao vivo: R$ %', v_max; end if;
  if (select balance from public.profiles where id = v_user) < p_stake then raise exception 'Saldo insuficiente'; end if;
  update public.bet_requests set status = 'rejected', reason = 'Substituído por novo pedido', done_at = now()
   where user_id = v_user and status = 'waiting' and selections = p_selections;
  insert into public.bet_requests (user_id, selections, stake, total_odd, scores)
  values (v_user, p_selections, p_stake, (v_q->>'total')::numeric, v_q->'scores') returning id into v_id;
  return jsonb_build_object('request', v_id, 'wait', v_wait);
end $$;

create or replace function public.place_bet_confirm(p_request bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_r public.bet_requests; v_q jsonb; v_why text; v_bet bigint;
  v_wait int := greatest(coalesce((public._setting('live_bet_delay'))::text::int, 7), 3);
begin
  select * into v_r from public.bet_requests where id = p_request and user_id = v_user for update;
  if not found or v_r.status <> 'waiting' then raise exception 'Pedido de aposta não encontrado'; end if;
  if v_r.created_at > now() - make_interval(secs => v_wait - 1) then raise exception 'Aguarde a confirmação da aposta'; end if;
  v_q := public._bet_quote(v_r.selections);
  if v_r.created_at < now() - interval '60 seconds' then v_why := 'Pedido expirado. Tente de novo.';
  elsif v_q ? 'error' then v_why := 'Aposta recusada: ' || (v_q->>'error');
  elsif v_q->'scores' <> v_r.scores then v_why := 'Aposta recusada: gol no jogo';
  elsif (v_q->>'total')::numeric < v_r.total_odd then v_why := format('Aposta recusada: a odd caiu para %s. Tente de novo.', v_q->>'total');
  end if;
  if v_why is not null then
    update public.bet_requests set status = 'rejected', reason = v_why, done_at = now() where id = p_request;
    return null;
  end if;
  perform set_config('rs.live_ok', '1', true);
  v_bet := public.place_bet(v_r.selections, v_r.stake);
  perform set_config('rs.live_ok', '', true);
  update public.bet_requests set status = 'placed', bet_id = v_bet, done_at = now() where id = p_request;
  return v_bet;
end $$;

create or replace function public.place_bet_reason(p_request bigint) returns text
language sql stable security definer set search_path = public as $$
  select reason from public.bet_requests where id = p_request and user_id = auth.uid()
$$;

create or replace function public.place_bet(p_selections jsonb, p_stake numeric) returns bigint
language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := public._me();
  v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_bet bigint;
  v_n int := jsonb_array_length(p_selections); v_live boolean := false;
  v_live_max numeric := coalesce((public._setting('live_bet_max_stake'))::text::numeric, 0);
begin
  if p_stake is null or p_stake < 1 then raise exception 'Aposta mínima: R$ 1,00'; end if;
  if v_n < 1 or v_n > 20 then raise exception 'O bilhete deve ter de 1 a 20 jogos'; end if;
  if (select count(distinct (e->>'match_id')) from jsonb_array_elements(p_selections) e) <> v_n then
    raise exception 'Só um palpite por jogo';
  end if;

  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_m from public.matches where id = (v_sel->>'match_id')::bigint for share;
    if not found or v_m.status not in ('open','live') then raise exception 'Jogo indisponível para apostas'; end if;
    if public._suspension(v_m) is not null then
      raise exception 'Apostas suspensas em % (%)', v_m.home || ' x ' || v_m.away, public._suspension(v_m);
    end if;
    v_odd := public._sel_odd(v_m, coalesce(v_sel->>'market', '1x2'), v_sel->>'pick');
    if v_odd is null or v_odd <= 1 then raise exception 'Palpite indisponível em %', v_m.home || ' x ' || v_m.away; end if;
    v_total := v_total * v_odd;
    v_live := v_live or v_m.status = 'live' or v_m.starts_at <= now();
  end loop;
  -- ao vivo só entra pela confirmação com espera (place_bet_request → place_bet_confirm)
  if v_live and coalesce(current_setting('rs.live_ok', true), '') <> '1' then
    raise exception 'Aposta ao vivo: atualize a página e tente de novo';
  end if;
  if v_live and v_live_max > 0 and p_stake > v_live_max then
    raise exception 'Aposta máxima ao vivo: R$ %', v_live_max;
  end if;
  v_total := round(v_total, 2);

  perform public._move(v_user, -p_stake, 'bet', 'Aposta esportiva');
  insert into public.bets (user_id, stake, total_odd, potential)
  values (v_user, p_stake, v_total, round(p_stake * v_total, 2)) returning id into v_bet;

  insert into public.bet_selections (bet_id, match_id, market, pick, odd)
  select v_bet, m.id, coalesce(e->>'market', '1x2'), e->>'pick', public._sel_odd(m, coalesce(e->>'market', '1x2'), e->>'pick')
  from jsonb_array_elements(p_selections) e join public.matches m on m.id = (e->>'match_id')::bigint;

  update public.transactions set description = 'Aposta #' || v_bet
   where id = (select max(id) from public.transactions where user_id = v_user and type = 'bet');
  return v_bet;
end $function$;

create or replace function public.cashout_request(p_bet bigint, p_expected numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_q jsonb; v_val numeric; v_id bigint;
  v_max numeric := coalesce((public._setting('live_cashout_max'))::text::numeric, 0);
begin
  perform 1 from public.bets where id = p_bet and user_id = v_user and status = 'pending' for update;
  if not found then raise exception 'Bilhete não disponível para cashout'; end if;
  v_q := public.cashout_quote(p_bet);
  if coalesce((v_q->>'suspended')::boolean, false) then raise exception 'Cashout suspenso: %', v_q->>'reason'; end if;
  v_val := (v_q->>'value')::numeric;
  if v_val is null or v_val <= 0 then raise exception 'Cashout indisponível no momento'; end if;
  if abs(v_val - p_expected) > 0.01 then raise exception 'O valor do cashout mudou para R$ %. Tente de novo.', v_val; end if;
  if not coalesce((v_q->>'live')::boolean, false) then
    return jsonb_build_object('paid', public._cashout_pay(p_bet, v_user, v_val));
  end if;
  if coalesce((public._setting('live_cashout_enabled'))::text::boolean, true) is false then
    raise exception 'Cashout ao vivo indisponível no momento';
  end if;
  if v_max > 0 and v_val > v_max then raise exception 'Cashout ao vivo acima do limite de R$ %', v_max; end if;
  update public.cashout_requests set status = 'rejected', reason = 'Substituído por novo pedido', done_at = now()
   where bet_id = p_bet and status = 'waiting';
  insert into public.cashout_requests (bet_id, user_id, expected, scores)
  values (p_bet, v_user, v_val, public._cashout_scores(p_bet)) returning id into v_id;
  return jsonb_build_object('request', v_id, 'wait', 7);
end $$;

revoke all on function public.place_bet_request(jsonb, numeric), public.place_bet_confirm(bigint), public.place_bet_reason(bigint), public._bet_quote(jsonb) from public, anon;
grant execute on function public.place_bet_request(jsonb, numeric), public.place_bet_confirm(bigint), public.place_bet_reason(bigint) to authenticated;
