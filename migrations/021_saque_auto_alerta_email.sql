-- Saque automático (via gateway de envio PIX, quando configurado) e alerta de aposta alta por e-mail.

insert into public.settings (key, value, label) values
  ('withdraw_auto', 'false', 'Saque automático: ligado'),
  ('withdraw_auto_max', '500', 'Saque automático: até (R$), só sem risco'),
  ('bet_alert_email', '""', 'Alerta por e-mail: destinatário(s), separados por vírgula'),
  ('bet_alert_amount', '1000', 'Alerta por e-mail: aposta a partir de (R$)')
on conflict (key) do nothing;

alter table public.transactions
  add column if not exists payout_status text check (payout_status in ('queued','sending','sent','failed')),
  add column if not exists payout_id text,
  add column if not exists payout_error text,
  add column if not exists payout_at timestamptz;
create index if not exists transactions_payout_queue on public.transactions (created_at) where payout_status in ('queued','sending');

-- ---------- saque automático ----------
create or replace function public._withdraw_auto_ok(p_level text, p_amount numeric) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((public._setting('withdraw_auto'))::text::boolean, false)
     and p_level = 'rapido'
     and abs(p_amount) <= coalesce((public._setting('withdraw_auto_max'))::text::numeric, 0)
$$;

create or replace function public.request_withdraw(p_amount numeric, p_pix_key text, p_pix_type text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_key text := public._pix_key_ok(p_pix_key, p_pix_type); v_id bigint;
begin
  v_id := public.request_withdraw(p_amount);
  update public.transactions set pix_key = v_key, pix_key_type = p_pix_type,
         payout_status = case when public._withdraw_auto_ok(review_level, amount) then 'queued' end
   where id = v_id;
  return v_id;
end $$;

-- Enquanto o gateway está enviando o PIX, ninguém aprova/recusa manualmente (evita pagar duas vezes).
create or replace function public._payout_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.payout_status = 'sending' and new.payout_status = 'sending' and new.status is distinct from old.status then
    raise exception 'Este saque está sendo enviado pelo gateway; aguarde o resultado';
  end if;
  return new;
end $$;
drop trigger if exists transactions_payout_guard on public.transactions;
create trigger transactions_payout_guard before update of status on public.transactions
  for each row execute function public._payout_guard();

-- Usado pela função ops-tick (service_role): pega saques na fila automática.
create or replace function public.payout_claim(p_limit int) returns setof public.transactions
language plpgsql security definer set search_path = public as $$
begin
  -- envio sem resposta há 10 min: volta para a fila manual (confira no gateway antes de pagar)
  update public.transactions set payout_status = 'failed', payout_error = 'Sem resposta do gateway em 10 min'
   where payout_status = 'sending' and payout_at < now() - interval '10 minutes';
  return query
    update public.transactions t set payout_status = 'sending', payout_at = now()
     where t.id in (select id from public.transactions
                     where type = 'withdraw' and status = 'pending' and payout_status = 'queued' and pix_key is not null
                     order by created_at limit p_limit for update skip locked)
    returning t.*;
end $$;

create or replace function public.payout_result(p_tx bigint, p_ok boolean, p_id text, p_error text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.transactions;
begin
  select * into v_t from public.transactions where id = p_tx and payout_status = 'sending' for update;
  if not found then return; end if;
  if p_ok then
    update public.transactions set status = 'done', payout_status = 'sent', payout_id = p_id, payout_error = null, reviewed_at = now()
     where id = p_tx;
    perform public._audit('financeiro.saque_auto', 'transaction', p_tx::text, null, to_jsonb(v_t),
                          jsonb_build_object('status', 'done', 'payout_id', p_id));
  else
    update public.transactions set payout_status = 'failed', payout_id = p_id, payout_error = left(p_error, 300) where id = p_tx;
  end if;
end $$;

-- ---------- alerta de aposta por e-mail ----------
create table if not exists public.email_outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  ref text unique,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts int not null default 0,
  error text
);
alter table public.email_outbox enable row level security;

create table if not exists public.ops_status (key text primary key, value jsonb, updated_at timestamptz not null default now());
alter table public.ops_status enable row level security;

create or replace function public._bet_email_alert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_to text := trim(coalesce(public._setting('bet_alert_email') #>> '{}', ''));
  v_min numeric := coalesce((public._setting('bet_alert_amount'))::text::numeric, 0);
  v_sel text; v_n int;
begin
  if v_to = '' or v_min <= 0 or new.stake < v_min then return null; end if;
  select count(*), string_agg(format('- %s x %s · %s: %s (odd %s)', m.home, m.away, coalesce(s.market, '1x2'),
           replace(s.pick, '|', ' + '), s.odd), E'\n' order by s.id)
    into v_n, v_sel
    from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = new.id;
  insert into public.email_outbox (to_email, subject, body, ref)
  values (v_to,
    format('Aposta de R$ %s no Real Sports (bilhete #%s)', to_char(new.stake, 'FM999G999G990D00'), new.id),
    format(E'Nova aposta acima de R$ %s.\n\nJogador: %s\nBilhete: #%s (%s)\nValor: R$ %s\nOdd total: %s\nRetorno possível: R$ %s\nData: %s\n\nSeleções:\n%s\n',
      v_min, coalesce((select email from public.profiles where id = new.user_id), new.user_id::text), new.id,
      case when coalesce(v_n, 0) > 1 then 'múltipla, ' || v_n || ' jogos' else 'simples' end,
      new.stake, new.total_odd, new.potential, to_char(new.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'),
      coalesce(v_sel, '-')),
    'bet:' || new.id)
  on conflict (ref) do nothing;
  return null;
end $$;
-- adiada para o fim da transação: as seleções do bilhete já estão gravadas
drop trigger if exists bets_email_alert on public.bets;
create constraint trigger bets_email_alert after insert on public.bets
  deferrable initially deferred for each row execute function public._bet_email_alert();

create or replace function public.email_claim(p_limit int) returns setof public.email_outbox
language sql security definer set search_path = public as $$
  update public.email_outbox e set attempts = attempts + 1
   where e.id in (select id from public.email_outbox where sent_at is null and attempts < 5
                   order by id limit p_limit for update skip locked)
  returning e.*
$$;

create or replace function public.email_result(p_id bigint, p_ok boolean, p_error text) returns void
language sql security definer set search_path = public as $$
  update public.email_outbox set sent_at = case when p_ok then now() end, error = case when p_ok then null else left(p_error, 300) end
   where id = p_id
$$;

create or replace function public.admin_automation() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_perm('finance.view');
  return jsonb_build_object(
    'status', (select jsonb_object_agg(key, value || jsonb_build_object('at', updated_at)) from public.ops_status),
    'queued', (select count(*) from public.transactions where payout_status in ('queued','sending') and status = 'pending'),
    'sent_today', (select count(*) from public.transactions where payout_status = 'sent' and payout_at > now() - interval '1 day'),
    'emails', (select coalesce(jsonb_agg(e order by e.id desc), '[]') from
      (select id, to_email, subject, created_at, sent_at, attempts, error from public.email_outbox order by id desc limit 30) e));
end $$;

create or replace function public.admin_email_test() returns void
language plpgsql security definer set search_path = public as $$
declare v_to text := trim(coalesce(public._setting('bet_alert_email') #>> '{}', ''));
begin
  perform public._require_perm('settings.manage');
  if v_to = '' then raise exception 'Salve primeiro o e-mail do alerta'; end if;
  insert into public.email_outbox (to_email, subject, body)
  values (v_to, 'Teste de alerta — Real Sports', E'Este é um e-mail de teste dos alertas de aposta do painel Real Sports.\n');
end $$;

revoke execute on function public._withdraw_auto_ok(text, numeric), public.payout_claim(int), public.payout_result(bigint, boolean, text, text),
  public.email_claim(int), public.email_result(bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.payout_claim(int), public.payout_result(bigint, boolean, text, text),
  public.email_claim(int), public.email_result(bigint, boolean, text) to service_role;
grant execute on function public.admin_automation(), public.admin_email_test() to authenticated;
grant execute on function public.request_withdraw(numeric, text, text) to authenticated;

-- ---------- ops-tick a cada minuto ----------
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $f$
      create or replace function public._call_ops_tick() returns bigint
      language sql security definer set search_path = public as $q$
        select net.http_post(
          url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/ops-tick',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 60000)
      $q$;
      revoke execute on function public._call_ops_tick() from public, anon, authenticated;
    $f$;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('ops-tick', '* * * * *', 'select public._call_ops_tick()');
  end if;
end $$;
