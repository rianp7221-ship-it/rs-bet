-- Mais mercados por jogo: Total de Gols (1,5/2,5/3,5), Ambas Marcam, Chance Dupla e Empate Anula
-- odds em matches.markets: {"ou25": {"over": 1.9, "under": 1.9}, "btts": {"yes": .., "no": ..},
--                           "dc": {"1x": .., "12": .., "x2": ..}, "dnb": {"home": .., "away": ..}}
alter table public.matches add column if not exists markets jsonb;
alter table public.bet_selections add column if not exists market text not null default '1x2';
alter table public.bet_selections drop constraint if exists bet_selections_pick_check;
alter table public.bet_selections drop constraint if exists bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick check (
  (market = '1x2' and pick in ('home','draw','away')) or
  (market in ('ou15','ou25','ou35') and pick in ('over','under')) or
  (market = 'btts' and pick in ('yes','no')) or
  (market = 'dc' and pick in ('1x','12','x2')) or
  (market = 'dnb' and pick in ('home','away')));

create or replace function public._sel_odd(m public.matches, p_market text, p_pick text) returns numeric
language sql immutable set search_path = public as $$
  select case when coalesce(p_market, '1x2') = '1x2' then
           case p_pick when 'home' then m.odd_home when 'draw' then m.odd_draw when 'away' then m.odd_away end
         else nullif((m.markets -> p_market ->> p_pick), '')::numeric end
$$;

-- resultado da seleção pelo placar final (90 min): won | lost | canceled (empate no Empate Anula = devolve)
create or replace function public._sel_outcome(p_market text, p_pick text, h int, a int) returns text
language sql immutable set search_path = public as $$
  select case
    when h is null or a is null then 'canceled'
    when p_market in ('ou15','ou25','ou35') then
      case when (h + a > case p_market when 'ou15' then 1.5 when 'ou25' then 2.5 else 3.5 end) = (p_pick = 'over') then 'won' else 'lost' end
    when p_market = 'btts' then case when (h > 0 and a > 0) = (p_pick = 'yes') then 'won' else 'lost' end
    when p_market = 'dc' then
      case when (p_pick = '1x' and h >= a) or (p_pick = 'x2' and h <= a) or (p_pick = '12' and h <> a) then 'won' else 'lost' end
    when p_market = 'dnb' then
      case when h = a then 'canceled' when (h > a) = (p_pick = 'home') then 'won' else 'lost' end
    else case when (case when h > a then 'home' when h < a then 'away' else 'draw' end) = p_pick then 'won' else 'lost' end
  end
$$;

create or replace function public.place_bet(p_selections jsonb, p_stake numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public._me();
  v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_bet bigint;
  v_n int := jsonb_array_length(p_selections);
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
  end loop;
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
end $$;

create or replace function public.settle_match(p_match bigint, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_m public.matches;
begin
  perform public._require_perm('sports.manage');
  if p_result not in ('home','draw','away') then raise exception 'Resultado inválido'; end if;
  update public.matches set status = 'settled', result = p_result where id = p_match and status <> 'settled' returning * into v_m;
  if not found then raise exception 'Jogo não encontrado ou já liquidado'; end if;
  update public.bet_selections set status = case when pick = p_result then 'won' else 'lost' end
   where match_id = p_match and status = 'pending' and market = '1x2';
  -- demais mercados pelo placar; sem placar coerente com o resultado (liquidação manual) => seleção anulada
  update public.bet_selections set status = public._sel_outcome(market, pick,
           case when (case when v_m.score_home > v_m.score_away then 'home' when v_m.score_home < v_m.score_away then 'away' else 'draw' end) = p_result
                then v_m.score_home end, v_m.score_away)
   where match_id = p_match and status = 'pending' and market <> '1x2';
  for r in select distinct s.bet_id from public.bet_selections s join public.bets b on b.id = s.bet_id
           where s.match_id = p_match and b.status = 'pending' loop
    perform public._resolve_bet(r.bet_id);
  end loop;
  perform public._audit('jogo.liquidar', 'match', p_match::text, null, null,
                        jsonb_build_object('jogo', v_m.home || ' x ' || v_m.away, 'resultado', p_result,
                                           'placar', v_m.score_home || '-' || v_m.score_away));
end $$;

create or replace function public.cashout_quote(p_bet bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_b public.bets; v_factor numeric := 1; r record; v_live boolean := false;
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' then return null; end if;
  for r in select s.status, m.status as m_status, m.starts_at, public._sel_odd(m, s.market, s.pick) as now_odd,
                  public._suspension(m) as reason
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      if r.reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', r.reason); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      if r.now_odd is null or r.now_odd <= 1 then return null; end if;
      v_factor := v_factor / r.now_odd;
    end if;
  end loop;
  return jsonb_build_object('value', least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential),
                            'suspended', false, 'live', v_live);
end $$;

revoke execute on function public._sel_odd(public.matches, text, text), public._sel_outcome(text, text, int, int) from public, anon, authenticated;
grant execute on function public.place_bet(jsonb, numeric), public.cashout_quote(bigint) to authenticated;
