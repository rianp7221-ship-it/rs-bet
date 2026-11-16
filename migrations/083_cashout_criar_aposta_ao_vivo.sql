-- Cash out do Criar Aposta ao vivo: odd justa recalculada com placar, minuto e estatísticas atuais.
-- Gols: Poisson do pré-jogo (bb_lh/bb_la) só para o tempo que falta (1º tempo = 45% dos gols, 2º = 55%), somado ao placar atual.
-- Estatísticas: perna já garantida (over passou da linha) vale 1; já perdida (under estourado) = sem cash out;
-- em aberto usa a odd ao vivo da fonte para a perna. Empate Anula com empate conta como perdida (cash out conservador).
create or replace function public._bb_live_odd(m public.matches, p_pick text) returns numeric
language plpgsql stable set search_path to 'public' as $$
declare
  legs text[] := string_to_array(p_pick, '|'); l text; mk text; pk text; lnv numeric; cur int; q float8; pst float8 := 1;
  ty text[] := '{}'; pks text[] := '{}'; ln numeric[] := '{}'; n int := 0; k int;
  mn float8; r1 float8; r2 float8; h0 int; a0 int; f1h int; f1a int; first boolean; u1 int;
  h1 float8[]; a1 float8[]; h2 float8[]; a2 float8[];
  i int; j int; x int; y int; h int; a int; fh int; fa int; ok boolean; p float8 := 0;
begin
  if m.status <> 'live' or m.bb_lh is null or m.bb_la is null or m.score_home is null or m.score_away is null
     or coalesce(m.period, '') not in ('1H', 'HT', '2H') then return null; end if;
  mn := least(greatest(coalesce(m.minute, 0), 0), 90);
  h0 := m.score_home; a0 := m.score_away; first := m.period = '1H';
  if first then
    r1 := 0.45 * greatest(45 - mn, 0) / 45; r2 := 0.55;
  else
    if m.ht_home is null or m.ht_away is null then return null; end if;
    f1h := m.ht_home; f1a := m.ht_away; r1 := 0;
    r2 := case when m.period = 'HT' then 0.55 else 0.55 * greatest(90 - greatest(mn, 45), 0) / 45 end;
  end if;
  foreach l in array legs loop
    mk := split_part(l, ':', 1); pk := split_part(l, ':', 2);
    if mk ~ '^(1x2|dc|dnb|btts|btts1|btts2|ht1x2|eg|cs|ou[0-9]+|hto[0-9]+|gh[0-9]+|ga[0-9]+)$' then
      n := n + 1; pks := pks || pk;
      ty := ty || case when mk ~ '^ou[0-9]' then 'ou' when mk ~ '^hto' then 'hto' when mk ~ '^g[ha][0-9]' then left(mk, 2) when mk = 'ht1x2' then 'ht'
                       when mk = 'btts1' then 'b1' when mk = 'btts2' then 'b2' else mk end;
      ln := ln || case when mk = 'eg' then substr(pk, 2)::numeric when mk ~ '[0-9]$' and mk ~ '^(ou|hto|gh|ga)' then regexp_replace(mk, '^[a-z]+', '')::numeric / 10 end;
    else
      if public._bb_stat(mk) is null then return null; end if;
      if mk !~ '1x2$' then
        lnv := regexp_replace(mk, '^[a-z]+', '')::numeric / 10;
        cur := case when mk ~ '^co[0-9]' then m.corners_home + m.corners_away when mk ~ '^ch[0-9]' then m.corners_home when mk ~ '^ca[0-9]' then m.corners_away
                    when mk ~ '^k[0-9]' then m.cards_home + m.cards_away when mk ~ '^kh[0-9]' then m.cards_home when mk ~ '^ka[0-9]' then m.cards_away
                    when mk ~ '^s[0-9]' then m.shots_home + m.shots_away when mk ~ '^sh[0-9]' then m.shots_home when mk ~ '^sa[0-9]' then m.shots_away
                    when mk ~ '^t[0-9]' then m.sot_home + m.sot_away end;
        if cur is not null and cur > lnv then
          if pk = 'over' then continue; end if;
          return null;
        end if;
      end if;
      q := public._bb_fair(m, mk, pk);
      if q is null or q <= 0 then return null; end if;
      pst := pst * q;
    end if;
  end loop;
  -- 1º tempo restante só existe durante o 1º tempo
  u1 := case when r1 > 0 then 6 else 0 end;
  h1 := array[exp(-r1*m.bb_lh::float8)]; a1 := array[exp(-r1*m.bb_la::float8)];
  h2 := array[exp(-r2*m.bb_lh::float8)]; a2 := array[exp(-r2*m.bb_la::float8)];
  for i in 1..8 loop
    h1 := h1 || h1[i]*r1*m.bb_lh::float8/i; a1 := a1 || a1[i]*r1*m.bb_la::float8/i;
    h2 := h2 || h2[i]*r2*m.bb_lh::float8/i; a2 := a2 || a2[i]*r2*m.bb_la::float8/i;
  end loop;
  if n = 0 then p := 1;
  else
    for i in 0..u1 loop for j in 0..u1 loop for x in 0..8 loop for y in 0..8 loop
      if first then fh := h0 + i; fa := a0 + j; h := fh + x; a := fa + y;
      else fh := f1h; fa := f1a; h := h0 + x; a := a0 + y; end if;
      ok := true;
      for k in 1..n loop
        if not (case ty[k]
            when '1x2' then (case when h > a then 'home' when h < a then 'away' else 'draw' end) = pks[k]
            when 'dc' then case pks[k] when '1x' then h >= a when 'x2' then h <= a else h <> a end
            when 'dnb' then h <> a and (h > a) = (pks[k] = 'home')
            when 'btts' then (h > 0 and a > 0) = (pks[k] = 'yes')
            when 'eg' then h + a = ln[k]
            when 'cs' then h = substr(pks[k], 2, 1)::int and a = substr(pks[k], 3, 1)::int
            when 'ou' then (h + a > ln[k]) = (pks[k] = 'over')
            when 'gh' then (h > ln[k]) = (pks[k] = 'over')
            when 'ga' then (a > ln[k]) = (pks[k] = 'over')
            when 'ht' then (case when fh > fa then 'home' when fh < fa then 'away' else 'draw' end) = pks[k]
            when 'hto' then (fh + fa > ln[k]) = (pks[k] = 'over')
            when 'b1' then (fh > 0 and fa > 0) = (pks[k] = 'yes')
            else (h - fh > 0 and a - fa > 0) = (pks[k] = 'yes') end) then ok := false; exit; end if;
      end loop;
      if ok then p := p + h1[i+1]*a1[j+1]*h2[x+1]*a2[y+1]; end if;
    end loop; end loop; end loop; end loop;
  end if;
  p := p * pst;
  if p < 0.002 then return null; end if;
  return greatest(round((1 / p)::numeric, 3), 1.001);
end $$;

-- ao vivo o Criar Aposta usa a odd recalculada; pré-jogo e demais mercados seguem iguais
create or replace function public._co_odd(m public.matches, p_market text, p_pick text) returns numeric
language sql stable set search_path to 'public' as $$
  select case when p_market = 'bb' and m.status = 'live' then public._bb_live_odd(m, p_pick)
              else coalesce(nullif(m.cashout_odds ->> (coalesce(p_market, '1x2') || ':' || p_pick), '')::numeric,
                            public._sel_odd_base(m, p_market, p_pick)) end
$$;
