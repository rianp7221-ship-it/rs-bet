-- =====================================================
--  047 — Mercado de cartões (API-Football, Bet365)
--  kNN = total de cartões mais/menos NN/10 (ex.: k35 = 3,5). Conta amarelos + vermelhos das estatísticas finais.
--  Cartões finais em matches.cards_home/away (gravados pelo sync-odds antes de liquidar); sem o dado => seleção anulada.
-- =====================================================
alter table public.matches add column if not exists cards_home int, add column if not exists cards_away int;

alter table public.bet_selections drop constraint if exists bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick check (
  (market = '1x2' and pick in ('home','draw','away')) or
  (market in ('ou15','ou25','ou35') and pick in ('over','under')) or
  (market = 'btts' and pick in ('yes','no')) or
  (market = 'dc' and pick in ('1x','12','x2')) or
  (market = 'dnb' and pick in ('home','away')) or
  (market = 'c1x2' and pick in ('home','draw','away')) or
  (market ~ '^co[0-9]{1,2}5$' and pick in ('over','under')) or
  (market ~ '^k[0-9]?5$' and pick in ('over','under')) or
  (market = 'bb' and pick ~ '^(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+(\|(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+){1,3}$'));

create or replace function public._card_outcome(p_market text, p_pick text, h int, a int) returns text
language sql immutable set search_path = public as $$
  select case
    when h is null or a is null then 'canceled'
    when (h + a > substring(p_market from 2)::numeric / 10) = (p_pick = 'over') then 'won' else 'lost' end
$$;

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
  -- escanteios e cartões pelo total oficial; sem o dado => anulada
  update public.bet_selections set status = public._corner_outcome(market, pick, v_m.corners_home, v_m.corners_away)
   where match_id = p_match and status = 'pending' and (market = 'c1x2' or market ~ '^co[0-9]');
  update public.bet_selections set status = public._card_outcome(market, pick, v_m.cards_home, v_m.cards_away)
   where match_id = p_match and status = 'pending' and market ~ '^k[0-9]';
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
                                           'placar', v_m.score_home || '-' || v_m.score_away,
                                           'escanteios', v_m.corners_home || '-' || v_m.corners_away,
                                           'cartoes', v_m.cards_home || '-' || v_m.cards_away));
end $$;
