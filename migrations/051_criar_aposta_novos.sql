-- =====================================================
--  051 — Criar Aposta com os mercados novos
--  Pernas de gols (1X2, chance dupla, ambas, linhas de gols, 1º tempo, ambas por tempo): Poisson do placar
--  (1º tempo = 45% dos gols esperados). Escanteios, cartões e chutes: probabilidade justa do próprio mercado,
--  no máximo 1 perna de cada grupo (correlação). Margem bb_margin e teto no produto das odds, como antes.
-- =====================================================
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
  (market = 'bb' and pick ~ '^[a-z0-9]+:[a-z0-9]+(\|[a-z0-9]+:[a-z0-9]+){1,3}$'));

-- perna de gols pelo placar final (h, a) e do 1º tempo (h1, a1)
create or replace function public._goal_leg(mk text, pk text, h int, a int, h1 int, a1 int) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  return case
    when mk in ('1x2','dc','btts','ou15','ou25','ou35') then public._sel_outcome(mk, pk, h, a) = 'won'
    when mk ~ '^ou[0-9]+$' then public._ou_outcome(mk, pk, h + a) = 'won'
    when mk = 'ht1x2' then (case when h1 > a1 then 'home' when h1 < a1 then 'away' else 'draw' end) = pk
    when mk ~ '^hto[0-9]+$' then public._ou_outcome(mk, pk, h1 + a1) = 'won'
    when mk = 'btts1' then (h1 > 0 and a1 > 0) = (pk = 'yes')
    when mk = 'btts2' then (h - h1 > 0 and a - a1 > 0) = (pk = 'yes')
  end;
end $$;

-- grupo das pernas de estatística (1 por grupo)
create or replace function public._bb_family(mk text) returns text
language sql immutable as $$
  select case when mk ~ '^(c1x2|co[0-9]+|ch[0-9]+|ca[0-9]+)$' then 'c'
              when mk ~ '^(k[0-9]+|kh[0-9]+|ka[0-9]+)$' then 'k'
              when mk ~ '^(s1x2|t1x2|[st][0-9]+|sh[0-9]+|sa[0-9]+)$' then 's' end
$$;

-- probabilidade justa (sem margem) de um palpite pelo próprio mercado
create or replace function public._bb_fair(m public.matches, mk text, pk text) returns float8
language sql stable set search_path = public as $$
  select (1 / nullif((m.markets -> mk ->> pk)::float8, 0))
       / nullif((select sum(1 / (v #>> '{}')::float8) from jsonb_each(m.markets -> mk) e(k, v) where (v #>> '{}')::float8 > 1), 0)
$$;

create or replace function public._bb_odd(m public.matches, p_pick text) returns numeric
language plpgsql stable set search_path = public as $$
declare
  legs text[] := string_to_array(p_pick, '|'); l text; mk text; pk text; o numeric; prod numeric := 1;
  gl text[] := '{}'; fams text[] := '{}'; f text; half boolean := false; pst float8 := 1; q float8;
  ph float8[]; pa float8[]; h1 float8[]; a1 float8[]; h2 float8[]; a2 float8[];
  i int; j int; x int; y int; p float8 := 0; ok boolean; v numeric;
  margin numeric := coalesce((public._setting('bb_margin') #>> '{}')::numeric, 10) / 100;
begin
  if m.status <> 'open' or m.starts_at <= now() or m.bb_lh is null or m.bb_la is null then return null; end if;
  if cardinality(legs) not between 2 and 4 then return null; end if;
  if (select count(distinct split_part(z, ':', 1)) from unnest(legs) z) <> cardinality(legs) then return null; end if;
  foreach l in array legs loop
    mk := split_part(l, ':', 1); pk := split_part(l, ':', 2);
    o := public._sel_odd(m, mk, pk);
    if o is null or o <= 1 then return null; end if;
    prod := prod * o;
    if mk ~ '^(1x2|dc|btts|btts1|btts2|ht1x2|ou[0-9]+|hto[0-9]+)$' then
      gl := gl || l;
      if mk ~ '^(ht1x2|btts1|btts2|hto[0-9]+)$' then half := true; end if;
    else
      f := public._bb_family(mk);
      if f is null or f = any(fams) then return null; end if;
      fams := fams || f;
      q := public._bb_fair(m, mk, pk);
      if q is null or q <= 0 then return null; end if;
      pst := pst * q;
    end if;
  end loop;
  if cardinality(gl) = 0 then p := 1;
  elsif not half then
    ph := array[exp(-m.bb_lh::float8)]; pa := array[exp(-m.bb_la::float8)];
    for i in 1..10 loop ph := ph || ph[i]*m.bb_lh::float8/i; pa := pa || pa[i]*m.bb_la::float8/i; end loop;
    for i in 0..10 loop for j in 0..10 loop
      ok := true;
      foreach l in array gl loop
        if not coalesce(public._goal_leg(split_part(l, ':', 1), split_part(l, ':', 2), i, j, 0, 0), false) then ok := false; exit; end if;
      end loop;
      if ok then p := p + ph[i+1]*pa[j+1]; end if;
    end loop; end loop;
  else
    h1 := array[exp(-0.45*m.bb_lh::float8)]; a1 := array[exp(-0.45*m.bb_la::float8)];
    h2 := array[exp(-0.55*m.bb_lh::float8)]; a2 := array[exp(-0.55*m.bb_la::float8)];
    for i in 1..6 loop
      h1 := h1 || h1[i]*0.45*m.bb_lh::float8/i; a1 := a1 || a1[i]*0.45*m.bb_la::float8/i;
      h2 := h2 || h2[i]*0.55*m.bb_lh::float8/i; a2 := a2 || a2[i]*0.55*m.bb_la::float8/i;
    end loop;
    for i in 0..6 loop for j in 0..6 loop for x in 0..6 loop for y in 0..6 loop
      ok := true;
      foreach l in array gl loop
        if not coalesce(public._goal_leg(split_part(l, ':', 1), split_part(l, ':', 2), i + x, j + y, i, j), false) then ok := false; exit; end if;
      end loop;
      if ok then p := p + h1[i+1]*a1[j+1]*h2[x+1]*a2[y+1]; end if;
    end loop; end loop; end loop; end loop;
  end if;
  p := p * pst;
  if p < 0.002 then return null; end if;
  v := round(least(prod, (1 / p)::numeric * (1 - margin)), 2);
  return case when v >= 1.05 then v end;
end $$;

-- resultado de uma perna pelo jogo liquidado (placar, 1º tempo e estatísticas)
create or replace function public._leg_outcome(m public.matches, mk text, pk text) returns text
language plpgsql immutable set search_path = public as $$
declare h int := m.score_home; a int := m.score_away;
begin
  if mk in ('1x2','dc','btts','ou15','ou25','ou35','dnb') then return public._sel_outcome(mk, pk, h, a);
  elsif mk ~ '^ou[0-9]+$' then return public._ou_outcome(mk, pk, h + a);
  elsif mk ~ '^hto[0-9]+$' then return public._ou_outcome(mk, pk, m.ht_home + m.ht_away);
  elsif mk in ('ht1x2','btts1','btts2') then
    if m.ht_home is null or m.ht_away is null or (mk = 'btts2' and (h is null or a is null)) then return 'canceled'; end if;
    return case when public._goal_leg(mk, pk, coalesce(h, 0), coalesce(a, 0), m.ht_home, m.ht_away) then 'won' else 'lost' end;
  elsif mk = 'c1x2' or mk ~ '^co[0-9]+$' then return public._corner_outcome(mk, pk, m.corners_home, m.corners_away);
  elsif mk ~ '^(ch|ca|kh|ka|sh|sa)[0-9]+$' then
    return public._ou_outcome(mk, pk, case left(mk, 2) when 'ch' then m.corners_home when 'ca' then m.corners_away
      when 'kh' then m.cards_home when 'ka' then m.cards_away when 'sh' then m.shots_home else m.shots_away end);
  elsif mk ~ '^k[0-9]+$' then return public._card_outcome(mk, pk, m.cards_home, m.cards_away);
  elsif mk ~ '^s([0-9]+|1x2)$' then return public._stat_outcome(mk, pk, m.shots_home, m.shots_away);
  elsif mk ~ '^t([0-9]+|1x2)$' then return public._stat_outcome(mk, pk, m.sot_home, m.sot_away);
  end if;
  return 'canceled';
end $$;

create or replace function public._bb_outcome(m public.matches, p_pick text) returns text
language plpgsql immutable set search_path = public as $$
declare l text; o text; v_all text := 'won';
begin
  foreach l in array string_to_array(p_pick, '|') loop
    o := public._leg_outcome(m, split_part(l, ':', 1), split_part(l, ':', 2));
    if o = 'lost' then return 'lost'; end if;
    if o <> 'won' then v_all := 'canceled'; end if;
  end loop;
  return v_all;
end $$;

create or replace function public.settle_match(p_match bigint, p_result text) returns void
language plpgsql security definer set search_path = public as $$
declare r record; v_m public.matches; v_mx public.matches; v_ok boolean; v_win text;
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
  -- Criar Aposta: cada perna pelo seu dado (placar só se coerente com o resultado)
  v_mx := v_m;
  if not v_ok then v_mx.score_home := null; v_mx.score_away := null; end if;
  update public.bet_selections set status = public._bb_outcome(v_mx, pick)
   where match_id = p_match and status = 'pending' and market = 'bb';
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
