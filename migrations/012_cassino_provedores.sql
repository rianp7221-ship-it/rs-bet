-- =====================================================
--  012 — Fase 7: provedores e jogos de cassino, RTP global/provedor/jogo,
--  limites de aposta por jogo e monitor do cassino
-- =====================================================
insert into public.role_permissions (role, perm) values
  ('trader','casino.view'), ('trader','casino.manage'),
  ('risco','casino.view'), ('financeiro','casino.view')
on conflict do nothing;

insert into public.settings (key, value, label) values
  ('casino_enabled', 'true', 'Cassino ligado (true/false)'),
  ('casino_rtp_global', '97', 'RTP global do cassino (%) — usado quando provedor/jogo não definem')
on conflict (key) do nothing;

create table if not exists public.casino_providers (
  id text primary key,
  name text not null,
  kind text not null default 'interno' check (kind in ('interno','agregador')),
  active boolean not null default true,
  rtp numeric(5,2) check (rtp is null or rtp between 80 and 99.5),
  updated_at timestamptz not null default now()
);

create table if not exists public.casino_catalog (
  id text primary key,
  provider text not null references public.casino_providers(id),
  name text not null,
  category text not null default 'originais' check (category in ('originais','slots','crash','ao_vivo','mesa')),
  active boolean not null default true,
  rtp numeric(5,2) check (rtp is null or rtp between 80 and 99.5),
  min_stake numeric(14,2) not null default 1 check (min_stake > 0),
  max_stake numeric(14,2) not null default 1000,
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  check (max_stake >= min_stake)
);

insert into public.casino_providers (id, name, kind) values ('realsports', 'Real Sports Originais', 'interno')
on conflict (id) do nothing;
insert into public.casino_catalog (id, provider, name, category, sort) values
  ('mines', 'realsports', 'Mines', 'originais', 1),
  ('dice', 'realsports', 'Dados', 'originais', 2)
on conflict (id) do nothing;

alter table public.casino_games add column if not exists rtp numeric(5,2);

alter table public.casino_providers enable row level security;
alter table public.casino_catalog enable row level security;
drop policy if exists "casino_providers_read" on public.casino_providers;
create policy "casino_providers_read" on public.casino_providers for select to anon, authenticated using (true);
drop policy if exists "casino_catalog_read" on public.casino_catalog;
create policy "casino_catalog_read" on public.casino_catalog for select to anon, authenticated using (true);
revoke insert, update, delete on public.casino_providers, public.casino_catalog from anon, authenticated;
grant select on public.casino_providers, public.casino_catalog to anon, authenticated;

-- configuração efetiva do jogo (RTP: jogo > provedor > global); erro se desligado
create or replace function public._casino_cfg(p_game text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.casino_catalog; p public.casino_providers;
begin
  select * into c from public.casino_catalog where id = p_game;
  if not found then raise exception 'Jogo não encontrado'; end if;
  select * into p from public.casino_providers where id = c.provider;
  if coalesce((public._setting('casino_enabled'))::text, 'true') not in ('true','"true"')
     or not c.active or not p.active then
    raise exception 'Este jogo está temporariamente indisponível';
  end if;
  return jsonb_build_object('rtp', coalesce(c.rtp, p.rtp, (public._setting('casino_rtp_global'))::text::numeric, 97),
    'min', c.min_stake, 'max', c.max_stake);
end $$;

create or replace function public._casino_stake(p_cfg jsonb, p_stake numeric) returns void
language plpgsql immutable as $$
begin
  if p_stake is null or p_stake < (p_cfg->>'min')::numeric then raise exception 'Aposta mínima: R$ %', to_char((p_cfg->>'min')::numeric, 'FM999G990D00'); end if;
  if p_stake > (p_cfg->>'max')::numeric then raise exception 'Aposta máxima neste jogo: R$ %', to_char((p_cfg->>'max')::numeric, 'FM999G990D00'); end if;
end $$;

create or replace function public._mines_mult_rtp(p_mines int, p_revealed int, p_rtp numeric) returns numeric
language sql immutable as $$
  select case when p_revealed = 0 then 1::numeric
    else round((coalesce(p_rtp, 97) / 100) * exp(sum(ln((25 - k)::numeric / (25 - p_mines - k)))), 4) end
  from generate_series(0, greatest(p_revealed - 1, 0)) k;
$$;

-- lista pública do lobby (só jogos ligados)
create or replace function public.casino_lobby() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'provider', p.name,
      'rtp', coalesce(c.rtp, p.rtp, (public._setting('casino_rtp_global'))::text::numeric, 97), 'min', c.min_stake, 'max', c.max_stake) order by c.sort), '[]')
  from public.casino_catalog c join public.casino_providers p on p.id = c.provider
  where c.active and p.active and coalesce((public._setting('casino_enabled'))::text, 'true') in ('true','"true"');
$$;

-- ---------- jogos usando a configuração ----------
create or replace function public.mines_start(p_stake numeric, p_mines int) returns json
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_id bigint; v_cfg jsonb := public._casino_cfg('mines');
begin
  perform public._casino_stake(v_cfg, p_stake);
  if p_mines is null or p_mines < 1 or p_mines > 24 then raise exception 'Escolha de 1 a 24 minas'; end if;
  if exists (select 1 from public.casino_games where user_id = v_user and game = 'mines' and status = 'active') then
    raise exception 'Você já tem uma partida de Mines em andamento';
  end if;
  perform public._move(v_user, -p_stake, 'casino_bet', 'Mines');
  insert into public.casino_games (user_id, game, stake, mines, bombs, rtp)
  values (v_user, 'mines', p_stake, p_mines,
          (select array_agg(c) from (select c from generate_series(0, 24) c order by gen_random_uuid() limit p_mines) x),
          (v_cfg->>'rtp')::numeric)
  returning id into v_id;
  return json_build_object('id', v_id, 'stake', p_stake, 'mines', p_mines, 'rtp', (v_cfg->>'rtp')::numeric);
end $$;

-- o RTP fica travado no início da partida (mudança no admin não afeta partida em andamento)
create or replace function public.mines_reveal(p_game bigint, p_cell int) returns json
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); g public.casino_games; v_mult numeric; v_pay numeric;
begin
  select * into g from public.casino_games where id = p_game and user_id = v_user and game = 'mines' and status = 'active' for update;
  if not found then raise exception 'Partida não encontrada'; end if;
  if p_cell < 0 or p_cell > 24 or p_cell = any(g.revealed) then raise exception 'Casa inválida'; end if;

  if p_cell = any(g.bombs) then
    update public.casino_games set status = 'lost', payout = 0, multiplier = 0 where id = p_game;
    return json_build_object('bomb', true, 'bombs', g.bombs);
  end if;

  g.revealed := g.revealed || p_cell;
  v_mult := public._mines_mult_rtp(g.mines, cardinality(g.revealed), g.rtp);
  if cardinality(g.revealed) = 25 - g.mines then
    v_pay := round(g.stake * v_mult, 2);
    update public.casino_games set revealed = g.revealed, multiplier = v_mult, payout = v_pay, status = 'won' where id = p_game;
    perform public._move(v_user, v_pay, 'casino_win', 'Mines #' || p_game);
    return json_build_object('bomb', false, 'cashout', true, 'bombs', g.bombs, 'payout', v_pay, 'multiplier', v_mult);
  end if;
  update public.casino_games set revealed = g.revealed, multiplier = v_mult where id = p_game;
  return json_build_object('bomb', false, 'multiplier', v_mult);
end $$;

create or replace function public.dice_roll(p_stake numeric, p_target int, p_over boolean) returns json
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_chance int; v_roll numeric; v_win boolean; v_mult numeric; v_pay numeric := 0;
  v_cfg jsonb := public._casino_cfg('dice');
begin
  perform public._casino_stake(v_cfg, p_stake);
  v_chance := case when p_over then 100 - p_target else p_target end;
  if v_chance is null or v_chance < 2 or v_chance > 95 then raise exception 'Chance deve ficar entre 2%% e 95%%'; end if;
  v_mult := round((v_cfg->>'rtp')::numeric / v_chance, 4);
  v_roll := (('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 10000) / 100.0;
  v_win := case when p_over then v_roll > p_target else v_roll < p_target end;
  perform public._move(v_user, -p_stake, 'casino_bet', 'Dados');
  if v_win then
    v_pay := round(p_stake * v_mult, 2);
    perform public._move(v_user, v_pay, 'casino_win', 'Dados');
  end if;
  insert into public.casino_games (user_id, game, stake, target, over, roll, multiplier, payout, status, rtp)
  values (v_user, 'dice', p_stake, p_target, p_over, v_roll, v_mult, v_pay, case when v_win then 'won' else 'lost' end, (v_cfg->>'rtp')::numeric);
  return json_build_object('roll', v_roll, 'win', v_win, 'payout', v_pay);
end $$;

-- ---------- admin ----------
create or replace function public.admin_casino_provider(p_id text, p_active boolean, p_rtp numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._require_perm('casino.manage');
  select to_jsonb(p) into v_before from public.casino_providers p where id = p_id;
  if v_before is null then raise exception 'Provedor não encontrado'; end if;
  update public.casino_providers set active = coalesce(p_active, active), rtp = p_rtp, updated_at = now() where id = p_id;
  perform public._audit('cassino.provedor', 'casino_provider', p_id, null, v_before, (select to_jsonb(p) from public.casino_providers p where id = p_id));
end $$;

create or replace function public.admin_casino_game(p_id text, p_active boolean, p_rtp numeric, p_min numeric, p_max numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._require_perm('casino.manage');
  select to_jsonb(c) into v_before from public.casino_catalog c where id = p_id;
  if v_before is null then raise exception 'Jogo não encontrado'; end if;
  update public.casino_catalog set active = coalesce(p_active, active), rtp = p_rtp,
    min_stake = coalesce(p_min, min_stake), max_stake = coalesce(p_max, max_stake), updated_at = now() where id = p_id;
  perform public._audit('cassino.jogo', 'casino_game', p_id, null, v_before, (select to_jsonb(c) from public.casino_catalog c where id = p_id));
end $$;

-- números do cassino por jogo no período + maiores prêmios
create or replace function public.admin_casino_stats(p_hours int default 24) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := now() - make_interval(hours => greatest(coalesce(p_hours, 24), 1));
begin
  perform public._require_perm('casino.view');
  return jsonb_build_object(
    'games', (select coalesce(jsonb_agg(x order by x.handle desc), '[]') from (
      select c.id, c.name, p.name as provider, c.active and p.active as active,
        coalesce(c.rtp, p.rtp, (public._setting('casino_rtp_global'))::text::numeric, 97) as rtp_config,
        count(g.id) as rounds, count(distinct g.user_id) as players,
        coalesce(sum(g.stake) filter (where g.status <> 'active'), 0) as handle,
        coalesce(sum(g.payout) filter (where g.status <> 'active'), 0) as paid,
        coalesce(sum(g.stake) filter (where g.status <> 'active'), 0) - coalesce(sum(g.payout) filter (where g.status <> 'active'), 0) as ggr,
        case when coalesce(sum(g.stake) filter (where g.status <> 'active'), 0) > 0
          then round(100 * coalesce(sum(g.payout) filter (where g.status <> 'active'), 0) / sum(g.stake) filter (where g.status <> 'active'), 2) end as rtp_real,
        count(g.id) filter (where g.status = 'active') as open_rounds
      from public.casino_catalog c join public.casino_providers p on p.id = c.provider
      left join public.casino_games g on g.game = c.id and g.created_at >= v_from
      group by c.id, c.name, p.name, c.active, p.active, c.rtp, p.rtp) x),
    'big_wins', (select coalesce(jsonb_agg(w), '[]') from (
      select g.id, g.game, g.user_id, pr.email, g.stake, g.multiplier, g.payout, g.created_at
      from public.casino_games g join public.profiles pr on pr.id = g.user_id
      where g.created_at >= v_from and g.status = 'won' and g.payout > g.stake
      order by g.payout - g.stake desc limit 15) w));
end $$;

revoke execute on function public._casino_cfg(text), public._casino_stake(jsonb, numeric) from public, anon, authenticated;
grant execute on function public.casino_lobby() to anon, authenticated;
grant execute on function public.admin_casino_provider(text, boolean, numeric), public.admin_casino_game(text, boolean, numeric, numeric, numeric),
  public.admin_casino_stats(int) to authenticated;
