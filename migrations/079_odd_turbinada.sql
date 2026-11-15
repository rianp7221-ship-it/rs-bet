-- 079 — Odd turbinada: 1 jogo por dia, escolhido sozinho (liga importante + times equilibrados).
-- Mercado próprio 'boost' (vitória do favorito +boost_pct%) nas boost_hours horas antes do jogo, sem cash out
-- e com aposta máxima. O 1x2 normal do mesmo jogo continua igual, com cash out. Liquida como o 1x2 (_sel_outcome).
insert into public.settings (key, value, label) values
  ('boost_pct', '20', 'Odd turbinada: % a mais na odd'),
  ('boost_hours', '3', 'Odd turbinada: horas de turbo antes do jogo começar'),
  ('boost_max_stake', '100', 'Odd turbinada: aposta máxima por pessoa no dia (R$)'),
  ('boost_ratio', '1.6', 'Odd turbinada: equilíbrio (odd do azarão / odd do favorito no máximo)'),
  ('boost_leagues', '["UEFA Champions League","CONMEBOL Libertadores","Brazil Série A","Copa do Brasil","Premier League","La Liga","UEFA Nations League","Serie A - Italy","Bundesliga","Ligue 1","UEFA Europa League","CONMEBOL Sudamericana","Primeira Liga Portugal","Liga Profesional Argentina","Brazil Série B","UEFA Conference League","Copa del Rey","FA Cup Inglaterra","Eredivisie Holanda","Liga MX México","MLS EUA","Saudi Pro League","Süper Lig Turquia","Championship Inglaterra"]', 'Odd turbinada: ligas que podem ser escolhidas, em ordem de importância')
on conflict (key) do nothing;

create table if not exists public.odds_boost (
  day date primary key,
  match_id bigint not null references public.matches(id) on delete cascade,
  market text not null default '1x2',
  pick text not null,
  pct numeric not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists odds_boost_match on public.odds_boost (match_id);
alter table public.odds_boost enable row level security;
drop policy if exists odds_boost_read on public.odds_boost;
create policy odds_boost_read on public.odds_boost for select using (true);

alter table public.bet_selections add column if not exists boosted boolean not null default false;
alter table public.bet_selections drop constraint if exists bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick CHECK ((((market = '1x2'::text) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market = ANY (ARRAY['ou15'::text, 'ou25'::text, 'ou35'::text])) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = 'btts'::text) AND (pick = ANY (ARRAY['yes'::text, 'no'::text]))) OR ((market = 'dc'::text) AND (pick = ANY (ARRAY['1x'::text, '12'::text, 'x2'::text]))) OR ((market = 'dnb'::text) AND (pick = ANY (ARRAY['home'::text, 'away'::text]))) OR ((market = 'c1x2'::text) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market ~ '^co[0-9]{1,2}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market ~ '^k[0-9]?5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = ANY (ARRAY['s1x2'::text, 't1x2'::text, 'ht1x2'::text])) AND (pick = ANY (ARRAY['home'::text, 'draw'::text, 'away'::text]))) OR ((market = ANY (ARRAY['btts1'::text, 'btts2'::text])) AND (pick = ANY (ARRAY['yes'::text, 'no'::text]))) OR ((market ~ '^(ou|hto|gh|ga|ch|ca|kh|ka|sh|sa)[0-9]{1,3}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market ~ '^[st][0-9]{1,3}5$'::text) AND (pick = ANY (ARRAY['over'::text, 'under'::text]))) OR ((market = 'eg'::text) AND (pick ~ '^g[0-6]$'::text)) OR ((market = 'cs'::text) AND (pick ~ '^s[0-6][0-6]$'::text)) OR ((market = 'bb'::text) AND (pick ~ '^[a-z0-9]+:[a-z0-9]+(\|[a-z0-9]+:[a-z0-9]+){1,12}$'::text)) OR ((market ~ '^hc[mp][0-9]{1,3}5$'::text) AND (pick = ANY (ARRAY['home'::text, 'away'::text]))) OR ((market = 'boost'::text) AND (pick = ANY (ARRAY['home'::text, 'away'::text]))))) NOT VALID;

-- odd sem turbo (era o _sel_odd); 'boost' usa a odd do 1x2
create or replace function public._sel_odd_base(m public.matches, p_market text, p_pick text)
returns numeric language sql stable set search_path = public as $$
  select case when p_market = 'bb' then public._bb_odd(m, p_pick)
         else (select case when c > 1 then least(o, c) else o end
                 from (select case when coalesce(p_market, '1x2') in ('1x2', 'boost') then
                                case p_pick when 'home' then m.odd_home when 'draw' then m.odd_draw when 'away' then m.odd_away end
                              else nullif((m.markets -> p_market ->> p_pick), '')::numeric end o,
                              coalesce((public._setting('odd_max'))::text::numeric, 0) c) t)
         end
$$;

-- % do turbo ativo agora nesse palpite (null = sem turbo)
create or replace function public._boost_pct(p_match bigint, p_pick text)
returns numeric language sql stable security definer set search_path = public as $$
  select b.pct from public.odds_boost b
   where b.match_id = p_match and b.pick = p_pick
     and now() >= b.starts_at and now() < b.ends_at
   limit 1
$$;

-- 'boost' só existe com turbo ativo e antes do jogo; fora disso o palpite fica indisponível
create or replace function public._sel_odd(m public.matches, p_market text, p_pick text)
returns numeric language sql stable set search_path = public as $$
  select case when coalesce(p_market, '1x2') <> 'boost' then o
              when o > 1 and p is not null then round(o * (1 + p / 100), 2) end
    from (select public._sel_odd_base(m, p_market, p_pick) o,
                 case when p_market = 'boost' and m.status = 'open' and m.starts_at > now() then public._boost_pct(m.id, p_pick) end p) t
$$;

-- cash out sempre pela odd sem turbo
create or replace function public._co_odd(m public.matches, p_market text, p_pick text)
returns numeric language sql stable set search_path = public as $$
  select coalesce(nullif(m.cashout_odds ->> (coalesce(p_market, '1x2') || ':' || p_pick), '')::numeric,
                  public._sel_odd_base(m, p_market, p_pick))
$$;

-- marca a seleção turbinada e aplica a aposta máxima do dia por pessoa
create or replace function public._bet_sel_boost() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_b public.bets; v_max numeric := coalesce((public._setting('boost_max_stake'))::text::numeric, 0); v_used numeric;
begin
  if new.market is distinct from 'boost' then return new; end if;
  new.boosted := true;
  select * into v_b from public.bets where id = new.bet_id;
  if v_max > 0 then
    select coalesce(sum(b.stake), 0) into v_used from public.bet_selections s join public.bets b on b.id = s.bet_id
     where s.boosted and s.match_id = new.match_id and b.user_id = v_b.user_id and b.status <> 'canceled';
    if v_used + v_b.stake > v_max then
      raise exception 'Odd turbinada: aposta máxima de R$ % por pessoa (você ainda pode apostar R$ %)',
        replace(to_char(v_max, 'FM999990.00'), '.', ','), replace(to_char(greatest(v_max - v_used, 0), 'FM999990.00'), '.', ',');
    end if;
  end if;
  return new;
end $$;
drop trigger if exists a1_boost on public.bet_selections;
create trigger a1_boost before insert on public.bet_selections for each row execute function public._bet_sel_boost();

-- bilhete com odd turbinada não tem cash out
create or replace function public.cashout_quote(p_bet bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b public.bets; v_factor numeric := 1; r record; v_live boolean := false; v_val numeric;
  v_min numeric := coalesce((public._setting('cashout_min'))::text::numeric, 0);
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' or v_b.freebet_id is not null then return null; end if;
  if exists (select 1 from public.bet_selections where bet_id = p_bet and boosted) then
    return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Odd turbinada: sem cash out', 'boost', true);
  end if;
  for r in select s.status, s.match_id, m.status as m_status, m.starts_at, public._co_odd(m, s.market, s.pick) as now_odd,
                  public._suspension(m) as reason
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      if r.reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', r.reason, 'match', r.match_id); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      if r.now_odd is null or r.now_odd <= 1 then
        return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Mercado indisponível', 'match', r.match_id);
      end if;
      v_factor := v_factor / r.now_odd;
    end if;
  end loop;
  v_val := least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential);
  if v_min > 0 and v_val < v_min then
    return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Abaixo do mínimo', 'now', v_val, 'min', v_min);
  end if;
  return jsonb_build_object('value', v_val, 'suspended', false, 'live', v_live);
end $$;

-- escolhe o jogo do dia (cron a cada 15 min; só age se ainda não tem jogo hoje, a partir das 7h)
create or replace function public.boost_pick() returns bigint
language plpgsql security definer set search_path = public as $$
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
   where m.status = 'open' and m.sport = 'Futebol'
     and m.starts_at > now() + interval '30 minutes'
     and (m.starts_at at time zone 'America/Sao_Paulo')::date = v_day
     and public._suspension(m) is null
     and m.odd_home > 1 and m.odd_away > 1
     and greatest(m.odd_home, m.odd_away) / least(m.odd_home, m.odd_away) <= v_ratio
   order by l.pos, greatest(m.odd_home, m.odd_away) / least(m.odd_home, m.odd_away), m.starts_at
   limit 1;
  if not found then return null; end if;
  insert into public.odds_boost (day, match_id, market, pick, pct, starts_at, ends_at)
  values (v_day, v_m.id, '1x2', case when v_m.odd_home <= v_m.odd_away then 'home' else 'away' end, v_pct,
          v_m.starts_at - make_interval(secs => (v_hours * 3600)::int), v_m.starts_at)
  on conflict (day) do nothing;
  return v_m.id;
end $$;
revoke all on function public.boost_pick() from public, anon, authenticated;

-- o que o site mostra: jogo do dia, odd normal, odd turbinada e o prazo
create or replace function public.boost_today() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('match', m.id, 'home', m.home, 'away', m.away, 'league', m.league, 'match_starts', m.starts_at,
           'home_logo', m.home_logo, 'away_logo', m.away_logo, 'market', b.market, 'pick', b.pick, 'pct', b.pct,
           'starts_at', b.starts_at, 'ends_at', b.ends_at, 'active', now() >= b.starts_at and now() < b.ends_at,
           'base', public._sel_odd_base(m, b.market, b.pick),
           'odd', round(public._sel_odd_base(m, b.market, b.pick) * (1 + b.pct / 100), 2),
           'max_stake', coalesce((public._setting('boost_max_stake'))::text::numeric, 0))
    from public.odds_boost b join public.matches m on m.id = b.match_id
   where b.ends_at > now() and m.status = 'open' and public._sel_odd_base(m, b.market, b.pick) > 1
   order by b.day desc limit 1
$$;
grant execute on function public.boost_today() to anon, authenticated;

select cron.unschedule('odds-boost') where exists (select 1 from cron.job where jobname = 'odds-boost');
select cron.schedule('odds-boost', '*/15 * * * *', $$select public.boost_pick()$$);
