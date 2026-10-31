-- =====================================================
--  008 — Correções da revisão: KPIs contam depósito/saque na data da aprovação
--  (reviewed_at) e transações só ficam visíveis para quem tem finance.view
-- =====================================================
create or replace function public.admin_kpis(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_tax numeric := coalesce((public._setting('ggr_tax_pct'))::text::numeric, 0);
  v_fee numeric := coalesce((public._setting('gateway_fee_pct'))::text::numeric, 0);
  s record; v_ggr numeric; v_ngr numeric; v_taxv numeric; v_feev numeric;
begin
  perform public._require_perm('kpi.view');
  select
    coalesce(-sum(amount) filter (where type = 'bet'), 0) as sports_handle,
    coalesce(-sum(amount) filter (where type = 'casino_bet'), 0) as casino_handle,
    coalesce(sum(amount) filter (where type in ('win','cashout')), 0) as sports_paid,
    coalesce(sum(amount) filter (where type = 'casino_win'), 0) as casino_paid,
    coalesce(sum(amount) filter (where type = 'bet_refund'), 0) as refunds,
    coalesce(sum(amount) filter (where type = 'bonus'), 0) as bonus,
    coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposits,
    coalesce(-sum(amount) filter (where type = 'withdraw'), 0) as withdrawals
  into s
  from public.transactions where status = 'done' and coalesce(reviewed_at, created_at) >= p_from and coalesce(reviewed_at, created_at) < p_to;
  v_ggr := s.sports_handle + s.casino_handle - s.sports_paid - s.casino_paid - s.refunds;
  v_ngr := v_ggr - s.bonus;
  v_taxv := round(greatest(v_ggr, 0) * v_tax / 100, 2);
  v_feev := round(s.deposits * v_fee / 100, 2);
  return jsonb_build_object(
    'handle', s.sports_handle + s.casino_handle, 'sports_handle', s.sports_handle, 'casino_handle', s.casino_handle,
    'prizes', s.sports_paid + s.casino_paid + s.refunds,
    'ggr', v_ggr, 'sports_ggr', s.sports_handle - s.sports_paid - s.refunds, 'casino_ggr', s.casino_handle - s.casino_paid,
    'bonus', s.bonus, 'ngr', v_ngr, 'tax', v_taxv, 'fees', v_feev, 'net', v_ngr - v_taxv - v_feev,
    'deposits', s.deposits, 'withdrawals', s.withdrawals,
    'pending_withdrawals', (select count(*) from public.transactions where type = 'withdraw' and status = 'pending'),
    'pending_withdrawals_sum', (select coalesce(-sum(amount), 0) from public.transactions where type = 'withdraw' and status = 'pending'),
    'pending_deposits', (select count(*) from public.transactions where type = 'deposit' and status = 'pending'),
    'signups', (select count(*) from public.profiles where created_at >= p_from and created_at < p_to),
    'ftd', (select count(*) from (select min(coalesce(reviewed_at, created_at)) f from public.transactions where type = 'deposit' and status = 'done' group by user_id) x
            where f >= p_from and f < p_to),
    'active', (select count(distinct user_id) from public.transactions
               where type in ('bet','casino_bet') and created_at >= p_from and created_at < p_to),
    'bets', (select count(*) from public.bets where created_at >= p_from and created_at < p_to),
    'player_balance', (select coalesce(sum(balance), 0) from public.profiles),
    'open_exposure', (select coalesce(sum(potential), 0) from public.bets where status = 'pending'),
    'open_alerts', (select count(*) from public.alerts where status <> 'resolvido'));
end $$;

-- série por hora ou dia (horário de Brasília) para os gráficos
create or replace function public.admin_series(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table (at timestamp, handle numeric, ggr numeric, deposits numeric, withdrawals numeric, signups bigint, bets_count bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_perm('kpi.view');
  if p_bucket not in ('hour','day') then raise exception 'Intervalo inválido'; end if;
  return query
  with g as (
    select generate_series(date_trunc(p_bucket, p_from at time zone 'America/Sao_Paulo'),
                           date_trunc(p_bucket, (p_to - interval '1 second') at time zone 'America/Sao_Paulo'),
                           ('1 ' || p_bucket)::interval) as b),
  t as (
    select date_trunc(p_bucket, coalesce(x.reviewed_at, x.created_at) at time zone 'America/Sao_Paulo') as b,
           coalesce(-sum(x.amount) filter (where x.type in ('bet','casino_bet')), 0) as h,
           coalesce(-sum(x.amount) filter (where x.type in ('bet','casino_bet','win','cashout','casino_win','bet_refund')), 0) as gg,
           coalesce(sum(x.amount) filter (where x.type = 'deposit'), 0) as d,
           coalesce(-sum(x.amount) filter (where x.type = 'withdraw'), 0) as w
    from public.transactions x where x.status = 'done' and coalesce(x.reviewed_at, x.created_at) >= p_from and coalesce(x.reviewed_at, x.created_at) < p_to group by 1),
  u as (select date_trunc(p_bucket, p.created_at at time zone 'America/Sao_Paulo') as b, count(*) as n
        from public.profiles p where p.created_at >= p_from and p.created_at < p_to group by 1),
  be as (select date_trunc(p_bucket, bt.created_at at time zone 'America/Sao_Paulo') as b, count(*) as n
         from public.bets bt where bt.created_at >= p_from and bt.created_at < p_to group by 1)
  select g.b, coalesce(t.h, 0), coalesce(t.gg, 0), coalesce(t.d, 0), coalesce(t.w, 0), coalesce(u.n, 0), coalesce(be.n, 0)
  from g left join t on t.b = g.b left join u on u.b = g.b left join be on be.b = g.b order by 1;
end $$;

create index if not exists transactions_event_idx on public.transactions ((coalesce(reviewed_at, created_at)));

drop policy if exists "transactions_read" on public.transactions;
create policy "transactions_read" on public.transactions for select to authenticated
  using (user_id = auth.uid() or public.has_perm('finance.view'));
