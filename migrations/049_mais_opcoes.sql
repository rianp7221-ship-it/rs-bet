-- =====================================================
--  049 — Mais opções dentro dos mercados (API-Football)
--  ht1x2 = resultado do 1º tempo; htoNN = gols do 1º tempo; btts1/btts2 = ambas marcam no 1º/2º tempo;
--  ou05/ou45/ou55 = mais linhas de gols; ch/ca, kh/ka, sh/sa + NN = escanteios, cartões e chutes de cada time.
--  Placar do 1º tempo em matches.ht_home/away (sync-odds). Sem o dado => seleção anulada.
-- =====================================================
alter table public.matches add column if not exists ht_home int, add column if not exists ht_away int;

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
  (market in ('s1x2','t1x2','ht1x2') and pick in ('home','draw','away')) or
  (market in ('btts1','btts2') and pick in ('yes','no')) or
  (market ~ '^(ou|hto|ch|ca|kh|ka|sh|sa)[0-9]{1,3}5$' and pick in ('over','under')) or
  (market ~ '^[st][0-9]{1,3}5$' and pick in ('over','under')) or
  (market = 'bb' and pick ~ '^(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+(\|(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+){1,3}$'));

create or replace function public._ou_outcome(p_market text, p_pick text, p_total int) returns text
language sql immutable set search_path = public as $$
  select case when p_total is null then 'canceled'
    when (p_total > regexp_replace(p_market, '^[a-z]+', '')::numeric / 10) = (p_pick = 'over') then 'won' else 'lost' end
$$;

create or replace function public.settle_match(p_match bigint, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_m public.matches; v_ok boolean; v_win text;
begin
  perform public._require_perm('sports.manage');
  if p_result not in ('home','draw','away') then raise exception 'Resultado inválido'; end if;
  update public.matches set status = 'settled', result = p_result where id = p_match and status <> 'settled' returning * into v_m;
  if not found then raise exception 'Jogo não encontrado ou já liquidado'; end if;
  update public.bet_selections set status = case when pick = p_result then 'won' else 'lost' end
   where match_id = p_match and status = 'pending' and market = '1x2';
  -- escanteios, cartões e chutes pelo total oficial; sem o dado => anulada
  update public.bet_selections set status = public._corner_outcome(market, pick, v_m.corners_home, v_m.corners_away)
   where match_id = p_match and status = 'pending' and (market = 'c1x2' or market ~ '^co[0-9]');
  update public.bet_selections set status = public._card_outcome(market, pick, v_m.cards_home, v_m.cards_away)
   where match_id = p_match and status = 'pending' and market ~ '^k[0-9]';
  update public.bet_selections set status = public._stat_outcome(market, pick, v_m.shots_home, v_m.shots_away)
   where match_id = p_match and status = 'pending' and market ~ '^s([0-9]+|1x2)$';
  update public.bet_selections set status = public._stat_outcome(market, pick, v_m.sot_home, v_m.sot_away)
   where match_id = p_match and status = 'pending' and market ~ '^t([0-9]+|1x2)$';
  -- placar coerente com o resultado (na liquidação manual pode não ser) e placar do 1º tempo
  v_ok := coalesce((case when v_m.score_home > v_m.score_away then 'home' when v_m.score_home < v_m.score_away then 'away' else 'draw' end) = p_result, false);
  v_win := case when v_m.ht_home > v_m.ht_away then 'home' when v_m.ht_home < v_m.ht_away then 'away' when v_m.ht_home = v_m.ht_away then 'draw' end;
  update public.bet_selections set status = public._ou_outcome(market, pick, case when v_ok then v_m.score_home + v_m.score_away end)
   where match_id = p_match and status = 'pending' and market in ('ou05','ou45','ou55');
  update public.bet_selections set status = case when v_win is null then 'canceled' when v_win = pick then 'won' else 'lost' end
   where match_id = p_match and status = 'pending' and market = 'ht1x2';
  update public.bet_selections set status = public._ou_outcome(market, pick, v_m.ht_home + v_m.ht_away)
   where match_id = p_match and status = 'pending' and market ~ '^hto[0-9]';
  update public.bet_selections set status = case when v_win is null then 'canceled'
           when ((v_m.ht_home > 0 and v_m.ht_away > 0) = (pick = 'yes')) then 'won' else 'lost' end
   where match_id = p_match and status = 'pending' and market = 'btts1';
  update public.bet_selections set status = case when v_win is null or not v_ok then 'canceled'
           when ((v_m.score_home - v_m.ht_home > 0 and v_m.score_away - v_m.ht_away > 0) = (pick = 'yes')) then 'won' else 'lost' end
   where match_id = p_match and status = 'pending' and market = 'btts2';
  update public.bet_selections set status = public._ou_outcome(market, pick,
           case left(market, 2) when 'ch' then v_m.corners_home when 'ca' then v_m.corners_away when 'kh' then v_m.cards_home
                                when 'ka' then v_m.cards_away when 'sh' then v_m.shots_home else v_m.shots_away end)
   where match_id = p_match and status = 'pending' and market ~ '^(ch|ca|kh|ka|sh|sa)[0-9]+$';
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
                                           'cartoes', v_m.cards_home || '-' || v_m.cards_away,
                                           'chutes', v_m.shots_home || '-' || v_m.shots_away,
                                           'chutes_gol', v_m.sot_home || '-' || v_m.sot_away,
                                           'intervalo', v_m.ht_home || '-' || v_m.ht_away));
end $$;
