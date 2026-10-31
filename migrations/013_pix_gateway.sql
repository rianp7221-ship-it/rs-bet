-- =====================================================
--  013 — PIX automático por gateway (Mercado Pago por padrão, adaptador trocável)
--  Depósito: pix-create gera a cobrança; pix-webhook (notificação do gateway + conciliação a cada 5 min)
--  confirma pela API do gateway e chama pix_confirm. Saque: jogador informa a chave PIX.
-- =====================================================
alter table public.transactions
  add column if not exists gateway text,
  add column if not exists expires_at timestamptz,
  add column if not exists pix_key text,
  add column if not exists pix_key_type text check (pix_key_type in ('cpf','cnpj','email','telefone','aleatoria'));
create unique index if not exists transactions_gateway_charge_uq on public.transactions (gateway, provider_id)
  where gateway is not null and provider_id is not null;
create index if not exists transactions_pending_gateway_idx on public.transactions (created_at)
  where type = 'deposit' and status = 'pending' and gateway is not null;

insert into public.settings (key, value, label) values
  ('pix_expire_minutes', '30', 'Validade do QR Code PIX de depósito (minutos)')
on conflict (key) do nothing;

-- confirma um depósito pago (só servidor: pix-webhook com service_role)
create or replace function public.pix_confirm(p_tx bigint, p_gateway text, p_charge text, p_amount numeric) returns text
language plpgsql security definer set search_path = public as $$
declare v_t public.transactions;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão'; end if;
  select * into v_t from public.transactions where id = p_tx for update;
  if not found or v_t.type <> 'deposit' then raise exception 'Depósito % não encontrado', p_tx; end if;
  if v_t.gateway is distinct from p_gateway or v_t.provider_id is distinct from p_charge then
    raise exception 'Cobrança % não pertence ao depósito %', p_charge, p_tx;
  end if;
  if v_t.status = 'done' then return 'ja_confirmado'; end if;
  if round(p_amount, 2) < v_t.amount then
    perform public._audit('financeiro.pix_divergente', 'transaction', p_tx::text, 'Valor pago menor que o depósito',
                          to_jsonb(v_t), jsonb_build_object('pago', p_amount));
    raise exception 'Valor pago (%) menor que o depósito (%)', p_amount, v_t.amount;
  end if;
  -- aceita também depósito expirado localmente que o gateway confirmou depois (o dinheiro entrou)
  update public.transactions set status = 'done', reviewed_at = now(), review_notes = 'PIX confirmado pelo gateway',
         fee = round(amount * coalesce((public._setting('gateway_fee_pct'))::text::numeric, 0) / 100, 2)
   where id = p_tx;
  update public.profiles set balance = balance + v_t.amount where id = v_t.user_id;
  insert into public.notifications (user_id, title, body)
  values (v_t.user_id, 'Depósito confirmado', format('Seu PIX de R$ %s caiu na sua conta.', to_char(v_t.amount, 'FM999G999G990D00')));
  perform public._audit('financeiro.pix_confirmado', 'transaction', p_tx::text, null, to_jsonb(v_t),
                        jsonb_build_object('status', 'done', 'gateway', p_gateway, 'charge', p_charge));
  return 'confirmado';
end $$;

-- cancela um depósito pendente expirado/recusado no gateway (só servidor)
create or replace function public.pix_fail(p_tx bigint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão'; end if;
  update public.transactions set status = 'rejected', reviewed_at = now(), review_notes = left(p_reason, 200)
   where id = p_tx and type = 'deposit' and status = 'pending';
end $$;

-- PIX devolvido/contestado no gateway depois de creditado: alerta crítico para o financeiro (só servidor)
create or replace function public.pix_refunded(p_tx bigint, p_detail text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.transactions;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão'; end if;
  select * into v_t from public.transactions where id = p_tx and type = 'deposit' and status = 'done';
  if found then
    perform public._alert('pix_devolvido', 'critica', v_t.user_id, 'tx:' || p_tx,
      format('PIX do depósito #%s (R$ %s) foi devolvido ou contestado no gateway (%s). Registre a contestação no Financeiro.', p_tx, v_t.amount, p_detail));
  end if;
end $$;

-- saque com chave PIX
create or replace function public._pix_key_ok(p_key text, p_type text) returns text
language plpgsql immutable as $$
declare k text := trim(coalesce(p_key, ''));
begin
  if p_type in ('cpf','cnpj','telefone') then k := regexp_replace(k, '\D', '', 'g'); end if;
  if p_type = 'cpf' and length(k) = 11 then return k; end if;
  if p_type = 'cnpj' and length(k) = 14 then return k; end if;
  if p_type = 'telefone' and length(k) between 10 and 13 then return '+' || case when length(k) <= 11 then '55' || k else k end; end if;
  if p_type = 'email' and k ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(k) <= 77 then return lower(k); end if;
  if p_type = 'aleatoria' and lower(k) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return lower(k); end if;
  raise exception 'Chave PIX inválida para o tipo %', coalesce(p_type, '?');
end $$;

create or replace function public.request_withdraw(p_amount numeric, p_pix_key text, p_pix_type text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_key text := public._pix_key_ok(p_pix_key, p_pix_type); v_id bigint;
begin
  v_id := public.request_withdraw(p_amount);
  update public.transactions set pix_key = v_key, pix_key_type = p_pix_type where id = v_id;
  return v_id;
end $$;

-- última chave usada (preenche o formulário de saque)
create or replace function public.my_last_pix_key() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('key', pix_key, 'type', pix_key_type) from public.transactions
   where user_id = auth.uid() and type = 'withdraw' and pix_key is not null order by created_at desc limit 1
$$;

revoke execute on function public.pix_confirm(bigint, text, text, numeric), public.pix_fail(bigint, text), public.pix_refunded(bigint, text) from public, anon, authenticated;
grant execute on function public.pix_confirm(bigint, text, text, numeric), public.pix_fail(bigint, text), public.pix_refunded(bigint, text) to service_role;
grant execute on function public.request_withdraw(numeric, text, text), public.my_last_pix_key() to authenticated;

-- ---------- conciliação automática a cada 5 min (pega PIX pago sem notificação e expira os vencidos) ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $f$
      create or replace function public._call_pix_reconcile() returns bigint
      language sql security definer set search_path = public as $q$
        select net.http_post(
          url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/pix-webhook?mode=reconcile',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 60000)
      $q$;
      revoke execute on function public._call_pix_reconcile() from public, anon, authenticated;
    $f$;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('pix-reconcile', '*/5 * * * *', 'select public._call_pix_reconcile()');
  end if;
end $$;
