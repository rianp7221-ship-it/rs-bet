-- 080 — Odd turbinada todo dia: se nenhum jogo das ligas importantes passar no boost_ratio,
-- entra o mais equilibrado delas. Aceita jogos que começam em até 15 min.
create or replace function public.boost_pick()
returns bigint language plpgsql security definer set search_path = public as $$
declare v_day date := public._today(); v_m public.matches;
  v_ratio numeric := coalesce((public._setting('boost_ratio'))::text::numeric, 1.6);
  v_hours numeric := coalesce((public._setting('boost_hours'))::text::numeric, 3);
  v_pct numeric := coalesce((public._setting('boost_pct'))::text::numeric, 20);
  v_lg jsonb := coalesce(public._setting('boost_leagues'), '[]');
begin
  if exists (select 1 from public.odds_boost where day = v_day) then return null; end if;
  if extract(hour from now() at time zone 'America/Sao_Paulo') < 7 or v_pct <= 0 then return null; end if;
  select m.* into v_m
    from public.matches m
    join jsonb_array_elements_text(v_lg) with ordinality l(name, pos) on l.name = m.league
    cross join lateral (select greatest(m.odd_home, m.odd_away) / least(m.odd_home, m.odd_away) r) q
   where m.status = 'open' and m.sport = 'Futebol'
     and m.starts_at > now() + interval '15 minutes'
     and (m.starts_at at time zone 'America/Sao_Paulo')::date = v_day
     and public._suspension(m) is null
     and m.odd_home > 1 and m.odd_away > 1
   order by q.r > v_ratio, case when q.r <= v_ratio then l.pos end, q.r, l.pos, m.starts_at
   limit 1;
  if not found then return null; end if;
  insert into public.odds_boost (day, match_id, market, pick, pct, starts_at, ends_at)
  values (v_day, v_m.id, '1x2', case when v_m.odd_home <= v_m.odd_away then 'home' else 'away' end, v_pct,
          v_m.starts_at - make_interval(secs => (v_hours * 3600)::int), v_m.starts_at)
  on conflict (day) do nothing;
  return v_m.id;
end $$;

select public.boost_pick();
