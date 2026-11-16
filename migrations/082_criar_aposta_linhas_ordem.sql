-- 082 — Criar Aposta: com várias linhas da mesma estatística, a média do Poisson usa todas as linhas do escopo
-- (antes vinha da primeira perna escolhida e a odd mudava com a ordem). Espelha bbStatQ em sports.js.
-- probabilidade conjunta das pernas de uma mesma estatística: Poisson casa/fora (médias tiradas das próprias linhas)
-- dá a correlação; cada perna é corrigida para a probabilidade justa do seu mercado (ps). Nunca acima da perna mais difícil.
create or replace function public._bb_stat_q(st text, mks text[], pks text[], ps float8[]) returns float8
language plpgsql immutable as $$
declare n int := cardinality(mks); k int; sc text[] := '{}'; ln float8[] := '{}'; lh float8; la float8; t float8;
  sum_h float8 := 0; sum_a float8 := 0; sum_t float8 := 0; cnt_h int := 0; cnt_a int := 0; cnt_t int := 0;
  dh float8; da float8; ph float8[]; pa float8[]; nh int; na int; i int; j int; w float8; pj float8 := 0; pm float8[];
  ok boolean; c boolean; q float8;
begin
  if n = 1 then return ps[1]; end if;
  dh := case st when 'c' then 5.3 when 'k' then 2.1 when 's' then 13 else 4.6 end;
  da := case st when 'c' then 4.4 when 'k' then 2.4 when 's' then 10.5 else 3.7 end;
  for k in 1..n loop
    sc := sc || case when mks[k] ~ '1x2$' then 'x' when mks[k] ~ '^(ch|kh|sh)' then 'h' when mks[k] ~ '^(ca|ka|sa)' then 'a' else 't' end;
    ln := ln || case when mks[k] ~ '1x2$' then null else regexp_replace(mks[k], '^[a-z]+', '')::float8 / 10 end;
    -- média tirada de todas as linhas do mesmo escopo (não depende da ordem das pernas)
    if sc[k] <> 'x' then
      q := public._pois_inv(ln[k], case when pks[k] = 'over' then ps[k] else 1 - ps[k] end);
      if sc[k] = 'h' then sum_h := sum_h + q; cnt_h := cnt_h + 1;
      elsif sc[k] = 'a' then sum_a := sum_a + q; cnt_a := cnt_a + 1;
      else sum_t := sum_t + q; cnt_t := cnt_t + 1; end if;
    end if;
  end loop;
  lh := sum_h / nullif(cnt_h, 0); la := sum_a / nullif(cnt_a, 0); t := sum_t / nullif(cnt_t, 0);
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

