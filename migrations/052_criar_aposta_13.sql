-- 052 — Criar Aposta: de 2 a 13 mercados do mesmo jogo (antes 2 a 4)
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
  (market = 'bb' and pick ~ '^[a-z0-9]+:[a-z0-9]+(\|[a-z0-9]+:[a-z0-9]+){1,12}$'));

-- pernas de gols avaliadas inline (sem chamar função por placar): com 13 pernas o cálculo fica rápido
create or replace function public._bb_odd(m public.matches, p_pick text) returns numeric
language plpgsql stable set search_path = public as $$
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
    if mk ~ '^(1x2|dc|btts|btts1|btts2|ht1x2|ou[0-9]+|hto[0-9]+)$' then
      n := n + 1; pks := pks || pk;
      ty := ty || case when mk ~ '^ou[0-9]' then 'ou' when mk ~ '^hto' then 'hto' when mk = 'ht1x2' then 'ht'
                       when mk = 'btts1' then 'b1' when mk = 'btts2' then 'b2' else mk end;
      ln := ln || case when mk ~ '[0-9]$' and mk ~ '^(ou|hto)' then regexp_replace(mk, '^[a-z]+', '')::numeric / 10 end;
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
end $$;
