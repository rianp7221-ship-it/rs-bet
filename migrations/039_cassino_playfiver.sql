-- =====================================================
--  039 — Cassino PlayFiver (carteira única: os jogos usam o saldo do site)
--  Catálogo em casino_catalog (id 'pf:<provedor>:<game_code>'), um casino_providers 'pf-<id>' por provedor.
--  A Edge Function `playfiver` abre o jogo e recebe os webhooks de saldo e de aposta/ganho/reembolso.
-- =====================================================
alter table public.casino_providers add column if not exists image text;
alter table public.casino_catalog
  add column if not exists pf_provider text,
  add column if not exists pf_code text,
  add column if not exists pf_original boolean,
  add column if not exists image text;
create index if not exists casino_catalog_pf_idx on public.casino_catalog (provider, sort) where pf_code is not null;

create table if not exists public.casino_tx (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id),
  txn_id text not null unique,
  round_id text,
  kind text not null check (kind in ('WinBet','Refund')),
  game_code text,
  provider text,
  bet numeric(14,2) not null default 0,
  win numeric(14,2) not null default 0,
  refunded boolean not null default false,
  raw jsonb,
  created_at timestamptz not null default now()
);
create index if not exists casino_tx_user_idx on public.casino_tx (user_id, created_at desc);
create index if not exists casino_tx_round_idx on public.casino_tx (round_id);
alter table public.casino_tx enable row level security;
drop policy if exists "casino_tx_read" on public.casino_tx;
create policy "casino_tx_read" on public.casino_tx for select to authenticated using (user_id = auth.uid() or public.is_admin());
revoke all on public.casino_tx from anon, authenticated;
grant select on public.casino_tx to authenticated;

-- lobby dos jogos internos (Mines/Dados/Leão) não carrega os milhares de jogos da PlayFiver
create or replace function public.casino_lobby() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'category', c.category, 'provider', p.name,
      'rtp', coalesce(c.rtp, p.rtp, (public._setting('casino_rtp_global'))::text::numeric, 97), 'min', c.min_stake, 'max', c.max_stake) order by c.sort), '[]')
  from public.casino_catalog c join public.casino_providers p on p.id = c.provider
  where c.pf_code is null and c.active and p.active and coalesce((public._setting('casino_enabled'))::text, 'true') in ('true','"true"');
$$;

create or replace function public.pf_balance(p_user text) returns numeric
language sql stable security definer set search_path = public as $$
  select balance from public.profiles where id::text = p_user;
$$;

-- aposta/ganho/reembolso vindos do webhook; idempotente por txn_id
create or replace function public.pf_tx(p jsonb) returns numeric
language plpgsql security definer set search_path = public as $$
declare
  s jsonb := coalesce(p->'slot', '{}'::jsonb);
  v_user uuid; v_txn text := s->>'txn_id'; v_round text := s->>'round_id';
  v_bet numeric := round(coalesce((s->>'bet')::numeric, 0), 2);
  v_win numeric := round(coalesce((s->>'win')::numeric, 0), 2);
  v_game text := coalesce(s->>'game_code', ''); o public.casino_tx;
begin
  select id into v_user from public.profiles where id::text = p->>'user_code';
  if v_user is null then raise exception 'Usuário não encontrado'; end if;
  if v_txn is null or v_txn = '' then raise exception 'txn_id ausente'; end if;
  if v_bet < 0 or v_win < 0 then raise exception 'Valor inválido'; end if;

  if p->>'type' = 'Refund' then
    if exists (select 1 from public.casino_tx where txn_id = 'refund:' || v_txn) then
      return (select balance from public.profiles where id = v_user);
    end if;
    select * into o from public.casino_tx
     where user_id = v_user and kind = 'WinBet' and not refunded and (txn_id = v_txn or (v_round is not null and round_id = v_round))
     order by (txn_id = v_txn) desc, id desc limit 1 for update;
    if found then
      update public.casino_tx set refunded = true where id = o.id;
      if o.bet - o.win <> 0 then perform public._move(v_user, o.bet - o.win, 'refund', 'Cassino: reembolso ' || coalesce(o.game_code, '')); end if;
    end if;
    insert into public.casino_tx (user_id, txn_id, round_id, kind, game_code, provider, bet, win, raw)
    values (v_user, 'refund:' || v_txn, v_round, 'Refund', v_game, s->>'provider_code', coalesce(o.bet, 0), coalesce(o.win, 0), p - 'agent_secret');
    return (select balance from public.profiles where id = v_user);
  end if;

  if exists (select 1 from public.casino_tx where txn_id = v_txn) then
    return (select balance from public.profiles where id = v_user);
  end if;
  if v_bet > 0 then perform public._move(v_user, -v_bet, 'casino_bet', 'Cassino: ' || v_game); end if;
  if v_win > 0 then perform public._move(v_user, v_win, 'casino_win', 'Cassino: ' || v_game); end if;
  insert into public.casino_tx (user_id, txn_id, round_id, kind, game_code, provider, bet, win, raw)
  values (v_user, v_txn, v_round, 'WinBet', v_game, s->>'provider_code', v_bet, v_win, p - 'agent_secret');
  return (select balance from public.profiles where id = v_user);
end $$;

revoke all on function public.pf_balance(text), public.pf_tx(jsonb) from public, anon, authenticated;
grant execute on function public.pf_balance(text), public.pf_tx(jsonb) to service_role;
