-- 056 — Placar Exato (cs: sHA = placar final H x A, 0..6), também no Criar Aposta.
alter table public.bet_selections drop constraint bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick CHECK ((((market = '1x2'::text) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market = ANY (ARRAY['ou15'::text, 'ou25'::text, 'ou35'::text])) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = 'btts'::text) AND (pick = ANY (ARRAY['yes'::text, 'no'::text]))) OR ((market = 'dc'::text) AND (pick = ANY (ARRAY['1x'::text, '12'::text, 'x2'::text]))) OR ((market = 'dnb'::text) AND (pick = ANY (ARRAY['home'::text, 'away'::text]))) OR ((market = 'c1x2'::text) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market ~ '^co[0-9]{1,2}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market ~ '^k[0-9]?5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = ANY (ARRAY['s1x2'::text, 't1x2'::text, 'ht1x2'::text])) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market = ANY (ARRAY['btts1'::text, 'btts2'::text])) AND (pick = ANY (ARRAY['yes'::text, 'no'::text]))) OR ((market ~ '^(ou|hto|ch|ca|kh|ka|sh|sa)[0-9]{1,3}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market ~ '^[st][0-9]{1,3}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = 'eg'::text) AND (pick ~ '^g[0-6]$'::text)) OR ((market = 'cs'::text) AND (pick ~ '^s[0-6][0-6]$'::text)) OR ((market = 'bb'::text) AND (pick ~ '^[a-z0-9]+:[a-z0-9]+(\|[a-z0-9]+:[a-z0-9]+){1,12}$'::text))));

CREATE OR REPLACE FUNCTION public._sel_outcome(p_market text, p_pick text, h integer, a integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare l text; o text; v_all text := 'won';
begin
  if h is null or a is null then return 'canceled'; end if;
  if p_market = 'bb' then
    foreach l in array string_to_array(p_pick, '|') loop
      o := public._sel_outcome(split_part(l, ':', 1), split_part(l, ':', 2), h, a);
      if o = 'lost' then return 'lost'; end if;
      if o <> 'won' then v_all := 'canceled'; end if;
    end loop;
    return v_all;
  end if;
  return case
    when p_market in ('ou15','ou25','ou35') then
      case when (h + a > case p_market when 'ou15' then 1.5 when 'ou25' then 2.5 else 3.5 end) = (p_pick = 'over') then 'won' else 'lost' end
    when p_market = 'eg' then case when h + a = substr(p_pick, 2)::int then 'won' else 'lost' end
    when p_market = 'cs' then case when h = substr(p_pick, 2, 1)::int and a = substr(p_pick, 3, 1)::int then 'won' else 'lost' end
    when p_market = 'btts' then case when (h > 0 and a > 0) = (p_pick = 'yes') then 'won' else 'lost' end
    when p_market = 'dc' then
      case when (p_pick = '1x' and h >= a) or (p_pick = 'x2' and h <= a) or (p_pick = '12' and h <> a) then 'won' else 'lost' end
    when p_market = 'dnb' then
      case when h = a then 'canceled' when (h > a) = (p_pick = 'home') then 'won' else 'lost' end
    else case when (case when h > a then 'home' when h < a then 'away' else 'draw' end) = p_pick then 'won' else 'lost' end
  end;
end $function$;

CREATE OR REPLACE FUNCTION public._leg_outcome(m matches, mk text, pk text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare h int := m.score_home; a int := m.score_away;
begin
  if mk in ('1x2','dc','btts','ou15','ou25','ou35','dnb','eg','cs') then return public._sel_outcome(mk, pk, h, a);
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
end $function$;

CREATE OR REPLACE FUNCTION public._bb_odd(m matches, p_pick text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  legs text[] := string_to_array(p_pick, '|'); l text; mk text; pk text; o numeric; prod numeric := 1;
  ty text[] := '{}'; pks text[] := '{}'; ln numeric[] := '{}'; n int := 0; k int;
  fams text[] := '{}'; f text; half boolean := false; pst float8 := 1; q float8;
  ph float8[]; pa float8[]; h1 float8[]; a1 float8[]; h2 float8[]; a2 float8[];
  i int; j int; x int; y int; h int; a int; p float8 := 0; ok boolean; v numeric;
  margin numeric := coalesce((public._setting('bb_margin') #>> '{}')::numeric, 10) / 100;
begin
  if m.status <> 'open' or m.starts_at <= now() or m.bb_lh is null or m.bb_la is null then return null; end if;
  if cardinality(legs) not between 2 and 13 then return null; end if;
  if (select count(distinct split_part(z, ':', 1)) from unnest(legs) z) <> cardinality(legs) then return null; end if;
  foreach l in array legs loop
    mk := split_part(l, ':', 1); pk := split_part(l, ':', 2);
    o := public._sel_odd(m, mk, pk);
    if o is null or o <= 1 then return null; end if;
    prod := prod * o;
    if mk ~ '^(1x2|dc|btts|btts1|btts2|ht1x2|eg|cs|ou[0-9]+|hto[0-9]+)$' then
      n := n + 1; pks := pks || pk;
      ty := ty || case when mk ~ '^ou[0-9]' then 'ou' when mk ~ '^hto' then 'hto' when mk = 'ht1x2' then 'ht'
                       when mk = 'btts1' then 'b1' when mk = 'btts2' then 'b2' else mk end;
      ln := ln || case when mk = 'eg' then substr(pk, 2)::numeric when mk ~ '[0-9]$' and mk ~ '^(ou|hto)' then regexp_replace(mk, '^[a-z]+', '')::numeric / 10 end;
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
  if n = 0 then p := 1;
  elsif not half then
    ph := array[exp(-m.bb_lh::float8)]; pa := array[exp(-m.bb_la::float8)];
    for i in 1..10 loop ph := ph || ph[i]*m.bb_lh::float8/i; pa := pa || pa[i]*m.bb_la::float8/i; end loop;
    for i in 0..10 loop for j in 0..10 loop
      ok := true;
      for k in 1..n loop
        if not (case ty[k]
            when '1x2' then (case when i > j then 'home' when i < j then 'away' else 'draw' end) = pks[k]
            when 'dc' then case pks[k] when '1x' then i >= j when 'x2' then i <= j else i <> j end
            when 'btts' then (i > 0 and j > 0) = (pks[k] = 'yes')
            when 'eg' then i + j = ln[k]
            when 'cs' then i = substr(pks[k], 2, 1)::int and j = substr(pks[k], 3, 1)::int
            else (i + j > ln[k]) = (pks[k] = 'over') end) then ok := false; exit; end if;
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
      h := i + x; a := j + y; ok := true;
      for k in 1..n loop
        if not (case ty[k]
            when '1x2' then (case when h > a then 'home' when h < a then 'away' else 'draw' end) = pks[k]
            when 'dc' then case pks[k] when '1x' then h >= a when 'x2' then h <= a else h <> a end
            when 'btts' then (h > 0 and a > 0) = (pks[k] = 'yes')
            when 'eg' then h + a = ln[k]
            when 'cs' then h = substr(pks[k], 2, 1)::int and a = substr(pks[k], 3, 1)::int
            when 'ou' then (h + a > ln[k]) = (pks[k] = 'over')
            when 'ht' then (case when i > j then 'home' when i < j then 'away' else 'draw' end) = pks[k]
            when 'hto' then (i + j > ln[k]) = (pks[k] = 'over')
            when 'b1' then (i > 0 and j > 0) = (pks[k] = 'yes')
            else (x > 0 and y > 0) = (pks[k] = 'yes') end) then ok := false; exit; end if;
      end loop;
      if ok then p := p + h1[i+1]*a1[j+1]*h2[x+1]*a2[y+1]; end if;
    end loop; end loop; end loop; end loop;
  end if;
  p := p * pst;
  if p < 0.002 then return null; end if;
  v := round(least(prod, (1 / p)::numeric * (1 - margin)), 2);
  return case when v >= 1.05 then v end;
end $function$;
