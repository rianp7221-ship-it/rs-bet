-- Contas em settings.kpi_hide_losses: no lucro de ESPORTES (GGR esportes, GGR, NGR, lucro líquido e gráfico)
-- o que o jogador perde não conta como lucro da casa; o que ele ganha acima do que apostou conta como prejuízo.
-- Valor apostado ("Total apostado") e cassino ficam como estão.
insert into public.settings (key, value, label)
values ('kpi_hide_losses', '["64a3e700-b9c4-499c-baf0-acdaa67e5aef"]'::jsonb, 'Contas sem lucro de esportes no painel (só prejuízo)')
on conflict (key) do nothing;

-- Correção a somar no GGR de esportes: tira as transações de esportes dessas contas e,
-- por bilhete encerrado, põe só o prejuízo da casa (least(0, apostado - devolvido)) na data do encerramento.
create or replace function public._kpi_sports_fix(p_from timestamptz, p_to timestamptz, p_bucket text)
returns table (b timestamp, v numeric)
language sql stable security definer set search_path = public as $$
  with h as (select (x #>> '{}')::uuid as id from jsonb_array_elements(coalesce(public._setting('kpi_hide_losses'), '[]'::jsonb)) x)
  select case when p_bucket is null then null else date_trunc(p_bucket, coalesce(t.reviewed_at, t.created_at) at time zone 'America/Sao_Paulo') end, sum(t.amount)
  from public.transactions t
  where t.status = 'done' and t.type in ('bet', 'win', 'cashout', 'bet_refund') and t.user_id in (select id from h)
    and coalesce(t.reviewed_at, t.created_at) >= p_from and coalesce(t.reviewed_at, t.created_at) < p_to
  group by 1
  union all
  select case when p_bucket is null then null else date_trunc(p_bucket, bt.settled_at at time zone 'America/Sao_Paulo') end,
         sum(least(0, coalesce((select -sum(x.amount) from public.transactions x
                                where x.user_id = bt.user_id and x.type = 'bet' and x.status = 'done' and x.description = 'Aposta #' || bt.id), 0)
                      - case bt.status when 'won' then bt.potential when 'cashout' then bt.cashout_amount when 'canceled' then bt.stake else 0 end))
  from public.bets bt
  where bt.user_id in (select id from h) and bt.status <> 'pending' and bt.settled_at >= p_from and bt.settled_at < p_to
  group by 1
$$;
revoke all on function public._kpi_sports_fix(timestamptz, timestamptz, text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_kpis(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tax numeric := coalesce((public._setting('ggr_tax_pct'))::text::numeric, 0);
  v_fee numeric := coalesce((public._setting('gateway_fee_pct'))::text::numeric, 0);
  s record; v_ggr numeric; v_hide numeric; v_free numeric; v_ngr numeric; v_taxv numeric; v_feev numeric;
begin
  perform public._require_perm('kpi.view');
  select
    coalesce(-sum(amount) filter (where type = 'bet'), 0) as sports_handle,
    coalesce(-sum(amount) filter (where type = 'casino_bet'), 0) as casino_handle,
    coalesce(sum(amount) filter (where type in ('win','cashout')), 0) as sports_paid,
    coalesce(sum(amount) filter (where type = 'casino_win' and not (coalesce(description, '') like 'Rodada grátis:%' and coalesce(reviewed_at, created_at) >= (public._setting('ggr_freespin_from') #>> '{}')::timestamptz)), 0) as casino_paid,
    coalesce(sum(amount) filter (where type = 'bet_refund'), 0) as refunds,
    coalesce(sum(amount) filter (where type = 'bonus'), 0) as bonus,
    coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposits,
    coalesce(-sum(amount) filter (where type = 'withdraw'), 0) as withdrawals
  into s
  from public.transactions where status = 'done' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null)) and coalesce(reviewed_at, created_at) >= p_from and coalesce(reviewed_at, created_at) < p_to;
  -- ajuste manual do GGR do cassino por dia (ggr_casino_adjust: {"AAAA-MM-DD": valor}), entra no dia que cruza o período
  v_free := (select coalesce(sum(a.v), 0) from (select (k::date::timestamp at time zone 'America/Sao_Paulo') as d0, v::numeric as v from jsonb_each_text(coalesce(public._setting('ggr_casino_adjust'), '{}'::jsonb)) as e(k, v)) a where a.d0 < p_to and a.d0 + interval '1 day' > p_from);
  v_hide := (select coalesce(sum(f.v), 0) from public._kpi_sports_fix(p_from, p_to, null) f);
  v_ggr := v_free + s.sports_handle + s.casino_handle - s.sports_paid - s.casino_paid - s.refunds + v_hide;
  v_ngr := v_ggr - s.bonus;
  v_taxv := round(greatest(v_ggr, 0) * v_tax / 100, 2);
  v_feev := round(s.deposits * v_fee / 100, 2);
  return jsonb_build_object(
    'handle', s.sports_handle + s.casino_handle, 'sports_handle', s.sports_handle, 'casino_handle', s.casino_handle,
    'prizes', s.sports_paid + s.casino_paid + s.refunds,
    'ggr', v_ggr, 'sports_ggr', s.sports_handle - s.sports_paid - s.refunds + v_hide, 'casino_ggr', s.casino_handle - s.casino_paid + v_free,
    'bonus', s.bonus, 'ngr', v_ngr, 'tax', v_taxv, 'fees', v_feev, 'net', v_ngr - v_taxv - v_feev,
    'deposits', s.deposits, 'withdrawals', s.withdrawals,
    'pending_withdrawals', (select count(*) from public.transactions where type = 'withdraw' and status = 'pending' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null))),
    'pending_withdrawals_sum', (select coalesce(-sum(amount), 0) from public.transactions where type = 'withdraw' and status = 'pending' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null))),
    'pending_deposits', (select count(*) from public.transactions where type = 'deposit' and status = 'pending' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null))),
    'signups', (select count(*) from public.profiles pr where not exists (select 1 from public.profiles kx where kx.id = pr.id and (kx.is_admin or kx.staff_role is not null)) and created_at >= p_from and created_at < p_to),
    'ftd', (select count(*) from (select min(coalesce(reviewed_at, created_at)) f from public.transactions where type = 'deposit' and status = 'done' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null)) group by user_id) x
            where f >= p_from and f < p_to),
    'active', (select count(distinct user_id) from public.transactions
               where type in ('bet','casino_bet') and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null)) and created_at >= p_from and created_at < p_to),
    'bets', (select count(*) from public.bets where not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null)) and created_at >= p_from and created_at < p_to),
    'player_balance', (select coalesce(sum(balance), 0) from public.profiles pr where not exists (select 1 from public.profiles kx where kx.id = pr.id and (kx.is_admin or kx.staff_role is not null))),
    'open_exposure', (select coalesce(sum(potential), 0) from public.bets where status = 'pending' and not exists (select 1 from public.profiles kx where kx.id = user_id and (kx.is_admin or kx.staff_role is not null))),
    'open_alerts', (select count(*) from public.alerts where status <> 'resolvido'));
end $function$;

CREATE OR REPLACE FUNCTION public.admin_series(p_from timestamp with time zone, p_to timestamp with time zone, p_bucket text)
 RETURNS TABLE(at timestamp without time zone, handle numeric, ggr numeric, deposits numeric, withdrawals numeric, signups bigint, bets_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           coalesce(-sum(x.amount) filter (where x.type in ('bet','casino_bet','win','cashout','casino_win','bet_refund') and not (x.type = 'casino_win' and coalesce(x.description, '') like 'Rodada grátis:%' and coalesce(x.reviewed_at, x.created_at) >= (public._setting('ggr_freespin_from') #>> '{}')::timestamptz)), 0) as gg,
           coalesce(sum(x.amount) filter (where x.type = 'deposit'), 0) as d,
           coalesce(-sum(x.amount) filter (where x.type = 'withdraw'), 0) as w
    from public.transactions x where x.status = 'done' and not exists (select 1 from public.profiles kx where kx.id = x.user_id and (kx.is_admin or kx.staff_role is not null)) and coalesce(x.reviewed_at, x.created_at) >= p_from and coalesce(x.reviewed_at, x.created_at) < p_to group by 1),
  f as (select date_trunc(p_bucket, greatest(a.d0, p_from) at time zone 'America/Sao_Paulo') as b, sum(a.v) as v
        from (select (k::date::timestamp at time zone 'America/Sao_Paulo') as d0, v::numeric as v from jsonb_each_text(coalesce(public._setting('ggr_casino_adjust'), '{}'::jsonb)) as e(k, v)) a where a.d0 < p_to and a.d0 + interval '1 day' > p_from group by 1),
  u as (select date_trunc(p_bucket, p.created_at at time zone 'America/Sao_Paulo') as b, count(*) as n
        from public.profiles p where not exists (select 1 from public.profiles kx where kx.id = p.id and (kx.is_admin or kx.staff_role is not null)) and p.created_at >= p_from and p.created_at < p_to group by 1),
  be as (select date_trunc(p_bucket, bt.created_at at time zone 'America/Sao_Paulo') as b, count(*) as n
         from public.bets bt where not exists (select 1 from public.profiles kx where kx.id = bt.user_id and (kx.is_admin or kx.staff_role is not null)) and bt.created_at >= p_from and bt.created_at < p_to group by 1),
  hx as (select x.b, sum(x.v) as v from public._kpi_sports_fix(p_from, p_to, p_bucket) x group by 1)
  select g.b, coalesce(t.h, 0), coalesce(t.gg, 0) + coalesce(f.v, 0) + coalesce(hx.v, 0), coalesce(t.d, 0), coalesce(t.w, 0), coalesce(u.n, 0), coalesce(be.n, 0)
  from g left join t on t.b = g.b left join f on f.b = g.b left join u on u.b = g.b left join be on be.b = g.b left join hx on hx.b = g.b order by 1;
end $function$;
