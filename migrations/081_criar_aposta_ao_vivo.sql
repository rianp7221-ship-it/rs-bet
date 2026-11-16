-- 081 — Criar Aposta: Empate Anula como perna (empate devolve a aposta) e várias linhas da mesma estatística
-- (ex.: Escanteios Casa + Escanteios Total), com a correlação entre elas por Poisson casa/fora.
-- Chutes e Chutes no Gol continuam sem combinar entre si. A liquidação das pernas (_leg_outcome) já cobre todos esses mercados.

-- estatística da perna: c escanteios, k cartões, s chutes, t chutes no gol
create or replace function public._bb_stat(mk text) returns text
language sql immutable as $$
  select case when mk ~ '^(c1x2|co[0-9]+|ch[0-9]+|ca[0-9]+)$' then 'c'
              when mk ~ '^(k[0-9]+|kh[0-9]+|ka[0-9]+)$' then 'k'
              when mk ~ '^(s1x2|s[0-9]+|sh[0-9]+|sa[0-9]+)$' then 's'
              when mk ~ '^(t1x2|t[0-9]+)$' then 't' end
$$;

-- média de Poisson com P(X > linha) = p
create or replace function public._pois_inv(p_line float8, p_over float8) returns float8
language plpgsql immutable as $$
declare lo float8 := 0.05; hi float8 := 80; l float8; c float8; t float8; i int; k int;
begin
  for k in 1..40 loop
    l := (lo + hi) / 2; t := exp(-l); c := t;
    for i in 1..floor(p_line)::int loop t := t * l / i; c := c + t; end loop;
    if 1 - c < p_over then lo := l; else hi := l; end if;
  end loop;
  return (lo + hi) / 2;
end $$;

-- probabilidade conjunta das pernas de uma mesma estatística: Poisson casa/fora (médias tiradas das próprias linhas)
-- dá a correlação; cada perna é corrigida para a probabilidade justa do seu mercado (ps). Nunca acima da perna mais difícil.
create or replace function public._bb_stat_q(st text, mks text[], pks text[], ps float8[]) returns float8
language plpgsql immutable as $$
declare n int := cardinality(mks); k int; sc text[] := '{}'; ln float8[] := '{}'; lh float8; la float8; t float8;
  dh float8; da float8; ph float8[]; pa float8[]; nh int; na int; i int; j int; w float8; pj float8 := 0; pm float8[];
  ok boolean; c boolean; q float8;
begin
  if n = 1 then return ps[1]; end if;
  dh := case st when 'c' then 5.3 when 'k' then 2.1 when 's' then 13 else 4.6 end;
  da := case st when 'c' then 4.4 when 'k' then 2.4 when 's' then 10.5 else 3.7 end;
  for k in 1..n loop
    sc := sc || case when mks[k] ~ '1x2$' then 'x' when mks[k] ~ '^(ch|kh|sh)' then 'h' when mks[k] ~ '^(ca|ka|sa)' then 'a' else 't' end;
    ln := ln || case when mks[k] ~ '1x2$' then null else regexp_replace(mks[k], '^[a-z]+', '')::float8 / 10 end;
    if sc[k] <> 'x' and (case sc[k] when 'h' then lh when 'a' then la else t end) is null then
      q := public._pois_inv(ln[k], case when pks[k] = 'over' then ps[k] else 1 - ps[k] end);
      if sc[k] = 'h' then lh := q; elsif sc[k] = 'a' then la := q; else t := q; end if;
    end if;
  end loop;
  if t is not null then
    if lh is not null and la is not null then q := t / (lh + la); lh := lh * q; la := la * q;
    elsif lh is not null then la := greatest(t - lh, 0.05);
    elsif la is not null then lh := greatest(t - la, 0.05);
    else lh := t * dh / (dh + da); la := t * da / (dh + da); end if;
  end if;
  lh := coalesce(lh, dh); la := coalesce(la, da);
  nh := ceil(lh + 6 * sqrt(lh) + 5); na := ceil(la + 6 * sqrt(la) + 5);
  ph := array[exp(-lh)]; pa := array[exp(-la)];
  for i in 1..nh loop ph := ph || ph[i] * lh / i; end loop;
  for i in 1..na loop pa := pa || pa[i] * la / i; end loop;
  pm := array_fill(0::float8, array[n]);
  for i in 0..nh loop for j in 0..na loop
    w := ph[i+1] * pa[j+1]; ok := true;
    for k in 1..n loop
      c := case sc[k] when 'x' then (case when i > j then 'home' when i < j then 'away' else 'draw' end) = pks[k]
                      when 'h' then (i > ln[k]) = (pks[k] = 'over')
                      when 'a' then (j > ln[k]) = (pks[k] = 'over')
                      else (i + j > ln[k]) = (pks[k] = 'over') end;
      if c then pm[k] := pm[k] + w; else ok := false; end if;
    end loop;
    if ok then pj := pj + w; end if;
  end loop; end loop;
  q := pj;
  for k in 1..n loop
    if pm[k] < 1e-9 then return null; end if;
    q := q * ps[k] / pm[k];
  end loop;
  return least(q, (select min(x) from unnest(ps) x));
end $$;

create or replace function public._bb_odd(m public.matches, p_pick text) returns numeric
language plpgsql stable set search_path = public as $$
declare
  legs text[] := string_to_array(p_pick, '|'); l text; mk text; pk text; o numeric; prod numeric := 1;
  ty text[] := '{}'; pks text[] := '{}'; ln numeric[] := '{}'; n int := 0; k int;
  sts text[] := '{}'; smk text[] := '{}'; spk text[] := '{}'; sps float8[] := '{}';
  f text; half boolean := false; pst float8 := 1; q float8;
  ph float8[]; pa float8[]; h1 float8[]; a1 float8[]; h2 float8[]; a2 float8[];
  i int; j int; x int; y int; h int; a int; p float8 := 0; pv float8 := 0; w float8; ok boolean; vd boolean; v numeric;
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
    if mk ~ '^(1x2|dc|dnb|btts|btts1|btts2|ht1x2|eg|cs|ou[0-9]+|hto[0-9]+|gh[0-9]+|ga[0-9]+)$' then
      n := n + 1; pks := pks || pk;
      ty := ty || case when mk ~ '^ou[0-9]' then 'ou' when mk ~ '^hto' then 'hto' when mk ~ '^g[ha][0-9]' then left(mk, 2) when mk = 'ht1x2' then 'ht'
                       when mk = 'btts1' then 'b1' when mk = 'btts2' then 'b2' else mk end;
      ln := ln || case when mk = 'eg' then substr(pk, 2)::numeric when mk ~ '[0-9]$' and mk ~ '^(ou|hto|gh|ga)' then regexp_replace(mk, '^[a-z]+', '')::numeric / 10 end;
      if mk ~ '^(ht1x2|btts1|btts2|hto[0-9]+)$' then half := true; end if;
    else
      f := public._bb_stat(mk);
      if f is null then return null; end if;
      q := public._bb_fair(m, mk, pk);
      if q is null or q <= 0 then return null; end if;
      sts := sts || f; smk := smk || mk; spk := spk || pk; sps := sps || q;
    end if;
  end loop;
  -- chutes e chutes no gol andam juntos demais: não combinam
  if 's' = any(sts) and 't' = any(sts) then return null; end if;
  foreach f in array array['c', 'k', 's', 't'] loop
    if f = any(sts) then
      q := public._bb_stat_q(f, array(select smk[z] from generate_subscripts(sts, 1) z where sts[z] = f order by z),
                                array(select spk[z] from generate_subscripts(sts, 1) z where sts[z] = f order by z),
                                array(select sps[z] from generate_subscripts(sts, 1) z where sts[z] = f order by z));
      if q is null or q <= 0 then return null; end if;
      pst := pst * q;
    end if;
  end loop;
  -- p = todas as pernas de gols ganham; pv = Empate Anula devolvido e nenhuma perdeu (aposta devolvida)
  if n = 0 then p := 1;
  elsif not half then
    ph := array[exp(-m.bb_lh::float8)]; pa := array[exp(-m.bb_la::float8)];
    for i in 1..10 loop ph := ph || ph[i]*m.bb_lh::float8/i; pa := pa || pa[i]*m.bb_la::float8/i; end loop;
    for i in 0..10 loop for j in 0..10 loop
      ok := true; vd := false;
      for k in 1..n loop
        if ty[k] = 'dnb' then
          if i = j then vd := true; elsif (i > j) <> (pks[k] = 'home') then ok := false; exit; end if;
          continue;
        end if;
        if not (case ty[k]
            when '1x2' then (case when i > j then 'home' when i < j then 'away' else 'draw' end) = pks[k]
            when 'dc' then case pks[k] when '1x' then i >= j when 'x2' then i <= j else i <> j end
            when 'btts' then (i > 0 and j > 0) = (pks[k] = 'yes')
            when 'eg' then i + j = ln[k]
            when 'cs' then i = substr(pks[k], 2, 1)::int and j = substr(pks[k], 3, 1)::int
            when 'gh' then (i > ln[k]) = (pks[k] = 'over')
            when 'ga' then (j > ln[k]) = (pks[k] = 'over')
            else (i + j > ln[k]) = (pks[k] = 'over') end) then ok := false; exit; end if;
      end loop;
      if ok then w := ph[i+1]*pa[j+1]; if vd then pv := pv + w; else p := p + w; end if; end if;
    end loop; end loop;
  else
    h1 := array[exp(-0.45*m.bb_lh::float8)]; a1 := array[exp(-0.45*m.bb_la::float8)];
    h2 := array[exp(-0.55*m.bb_lh::float8)]; a2 := array[exp(-0.55*m.bb_la::float8)];
    for i in 1..6 loop
      h1 := h1 || h1[i]*0.45*m.bb_lh::float8/i; a1 := a1 || a1[i]*0.45*m.bb_la::float8/i;
      h2 := h2 || h2[i]*0.55*m.bb_lh::float8/i; a2 := a2 || a2[i]*0.55*m.bb_la::float8/i;
    end loop;
    for i in 0..6 loop for j in 0..6 loop for x in 0..6 loop for y in 0..6 loop
      h := i + x; a := j + y; ok := true; vd := false;
      for k in 1..n loop
        if ty[k] = 'dnb' then
          if h = a then vd := true; elsif (h > a) <> (pks[k] = 'home') then ok := false; exit; end if;
          continue;
        end if;
        if not (case ty[k]
            when '1x2' then (case when h > a then 'home' when h < a then 'away' else 'draw' end) = pks[k]
            when 'dc' then case pks[k] when '1x' then h >= a when 'x2' then h <= a else h <> a end
            when 'btts' then (h > 0 and a > 0) = (pks[k] = 'yes')
            when 'eg' then h + a = ln[k]
            when 'cs' then h = substr(pks[k], 2, 1)::int and a = substr(pks[k], 3, 1)::int
            when 'ou' then (h + a > ln[k]) = (pks[k] = 'over')
            when 'gh' then (h > ln[k]) = (pks[k] = 'over')
            when 'ga' then (a > ln[k]) = (pks[k] = 'over')
            when 'ht' then (case when i > j then 'home' when i < j then 'away' else 'draw' end) = pks[k]
            when 'hto' then (i + j > ln[k]) = (pks[k] = 'over')
            when 'b1' then (i > 0 and j > 0) = (pks[k] = 'yes')
            else (x > 0 and y > 0) = (pks[k] = 'yes') end) then ok := false; exit; end if;
      end loop;
      if ok then w := h1[i+1]*a1[j+1]*h2[x+1]*a2[y+1]; if vd then pv := pv + w; else p := p + w; end if; end if;
    end loop; end loop; end loop; end loop;
  end if;
  -- odd justa com devolução: odd * P(ganha) + P(devolvida) = 1
  if pv * pst >= 0.999 then return null; end if;
  p := p * pst / (1 - pv * pst);
  if p < 0.002 then return null; end if;
  v := round(least(prod, (1 / p)::numeric * (1 - margin)), 2);
  return case when v >= 1.05 then v end;
end $$;
