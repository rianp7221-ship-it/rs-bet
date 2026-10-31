-- =====================================================
--  006 — Painel admin, fase 3: fila de saques com regras, dupla aprovação de saque alto e reconciliação
-- =====================================================
alter table public.transactions
  add column if not exists review_level text check (review_level in ('rapido','manual','dupla')),
  add column if not exists review_notes text,
  add column if not exists first_approver uuid,
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists fee numeric(14,2) not null default 0,
  add column if not exists method text not null default 'PIX';

insert into public.settings (key, value, label) values
  ('withdraw_fast_limit', '500', 'Saque até (R$) entra na fila rápida se não houver risco'),
  ('withdraw_dual_limit', '5000', 'Saque a partir de (R$) precisa de 2 aprovadores (0 = desligado)'),
  ('withdraw_daily_max', '20000', 'Máximo de saque por jogador por dia (R$)')
on conflict (key) do nothing;

-- classifica o saque: rápido (baixo risco), manual (motivos listados) ou dupla aprovação
create or replace function public._classify_withdraw(p_user uuid, p_amount numeric) returns text[]
language plpgsql stable security definer set search_path = public as $$
declare v_p public.profiles; v_reasons text[] := '{}'; v_dep numeric; v_bet numeric;
  v_fast numeric := coalesce((public._setting('withdraw_fast_limit'))::text::numeric, 0);
  v_dual numeric := coalesce((public._setting('withdraw_dual_limit'))::text::numeric, 0);
begin
  select * into v_p from public.profiles where id = p_user;
  if v_p.risk_level <> 'baixo' then v_reasons := v_reasons || ('risco ' || v_p.risk_level); end if;
  if exists (select 1 from public.alerts where user_id = p_user and status <> 'resolvido') then v_reasons := v_reasons || 'alerta aberto'::text; end if;
  select coalesce(sum(amount), 0) into v_dep from public.transactions where user_id = p_user and type = 'deposit' and status = 'done';
  select coalesce(-sum(amount), 0) into v_bet from public.transactions where user_id = p_user and type in ('bet','casino_bet') and status = 'done';
  if v_bet < v_dep then v_reasons := v_reasons || format('apostou R$ %s de R$ %s depositados', v_bet, v_dep); end if;
  if p_amount > v_fast then v_reasons := v_reasons || format('acima de R$ %s', v_fast); end if;
  return array[case when v_dual > 0 and p_amount >= v_dual then 'dupla' when cardinality(v_reasons) = 0 then 'rapido' else 'manual' end]
         || v_reasons;
end $$;

create or replace function public.request_withdraw(p_amount numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_id bigint; v_c text[]; v_today numeric;
  v_max numeric := coalesce((public._setting('withdraw_daily_max'))::text::numeric, 0);
begin
  if p_amount is null or p_amount < 20 then raise exception 'Saque mínimo: R$ 20,00'; end if;
  select coalesce(-sum(amount), 0) into v_today from public.transactions
   where user_id = v_user and type = 'withdraw' and status in ('pending','done') and created_at > now() - interval '1 day';
  if v_max > 0 and v_today + p_amount > v_max then raise exception 'Limite diário de saque: R$ %', v_max; end if;
  v_c := public._classify_withdraw(v_user, round(p_amount, 2));
  update public.profiles set balance = balance - round(p_amount, 2) where id = v_user and balance >= round(p_amount, 2);
  if not found then raise exception 'Saldo insuficiente'; end if;
  insert into public.transactions (user_id, type, amount, status, description, review_level, review_notes)
  values (v_user, 'withdraw', -round(p_amount, 2), 'pending', 'Saque PIX', v_c[1], nullif(array_to_string(v_c[2:], ' · '), ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.admin_review_transaction(p_tx bigint, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.transactions;
begin
  perform public._require_perm('finance.manage');
  select * into v_t from public.transactions where id = p_tx and status = 'pending' for update;
  if not found then raise exception 'Transação não está pendente'; end if;
  if p_approve and v_t.type = 'withdraw' and v_t.review_level = 'dupla' then
    if v_t.first_approver is null then
      update public.transactions set first_approver = auth.uid() where id = p_tx;
      perform public._audit('financeiro.1a_aprovacao', 'transaction', p_tx::text, null, to_jsonb(v_t), jsonb_build_object('first_approver', auth.uid()));
      return;
    elsif v_t.first_approver = auth.uid() then
      raise exception 'Saque alto: outra pessoa precisa dar a 2ª aprovação';
    end if;
  end if;
  update public.transactions set status = case when p_approve then 'done' else 'rejected' end, reviewed_by = auth.uid(), reviewed_at = now(),
         fee = case when p_approve and type = 'deposit' then round(amount * coalesce((public._setting('gateway_fee_pct'))::text::numeric, 0) / 100, 2) else fee end
   where id = p_tx;
  if v_t.type = 'deposit' and p_approve then
    update public.profiles set balance = balance + v_t.amount where id = v_t.user_id;
  elsif v_t.type = 'withdraw' and not p_approve then
    perform public._move(v_t.user_id, abs(v_t.amount), 'refund', 'Saque #' || p_tx || ' recusado');
  end if;
  perform public._audit(case when p_approve then 'financeiro.aprovar' else 'financeiro.recusar' end, 'transaction', p_tx::text, null,
                        to_jsonb(v_t), jsonb_build_object('status', case when p_approve then 'done' else 'rejected' end));
end $$;

-- reconciliação por dia (horário de Brasília): entradas, saídas, taxas e saldo retido
create or replace function public.admin_reconciliation(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_perm('finance.view');
  return jsonb_build_object(
    'days', coalesce((select jsonb_agg(to_jsonb(x) order by x.day) from (
       select (created_at at time zone 'America/Sao_Paulo')::date as day,
         coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposits,
         count(*) filter (where type = 'deposit') as deposits_n,
         coalesce(-sum(amount) filter (where type = 'withdraw'), 0) as withdrawals,
         count(*) filter (where type = 'withdraw') as withdrawals_n,
         coalesce(sum(fee), 0) as fees,
         coalesce(sum(amount) filter (where type in ('deposit','withdraw')), 0) - coalesce(sum(fee), 0) as net
       from public.transactions where status = 'done' and type in ('deposit','withdraw') and created_at >= p_from and created_at < p_to
       group by 1) x), '[]'),
    'retained', (select coalesce(sum(balance), 0) from public.profiles),
    'pending_withdrawals', (select coalesce(-sum(amount), 0) from public.transactions where type = 'withdraw' and status = 'pending'),
    'pending_deposits', (select coalesce(sum(amount), 0) from public.transactions where type = 'deposit' and status = 'pending'),
    'ledger_diff', (select count(*) from public.alerts where kind = 'saldo_divergente' and status <> 'resolvido'));
end $$;

revoke execute on function public._classify_withdraw(uuid, numeric) from public, anon, authenticated;
grant execute on function public.request_withdraw(numeric), public.admin_review_transaction(bigint, boolean),
  public.admin_reconciliation(timestamptz, timestamptz) to authenticated;
