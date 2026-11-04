-- E-mail a cada pedido de saque e valor mínimo/máximo por depósito e por saque (Admin → Configurações; 0 = sem máximo).

insert into public.settings (key, value, label) values
  ('deposit_min', '1', 'Depósito: valor mínimo por PIX (R$)'),
  ('deposit_max', '0', 'Depósito: valor máximo por PIX (R$, 0 = sem limite)'),
  ('withdraw_min', '20', 'Saque: valor mínimo por pedido (R$)'),
  ('withdraw_max', '0', 'Saque: valor máximo por pedido (R$, 0 = sem limite)'),
  ('withdraw_alert_email', coalesce((select value from public.settings where key = 'bet_alert_email'), '""'),
   'Saque: e-mail(s) avisados a cada pedido, separados por vírgula')
on conflict (key) do nothing;

create or replace function public._brl(v numeric) returns text
language sql immutable as $$ select 'R$ ' || replace(to_char(v, 'FM999999990.00'), '.', ',') $$;

create or replace function public.money_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'dep_min', coalesce((public._setting('deposit_min'))::text::numeric, 1),
    'dep_max', coalesce((public._setting('deposit_max'))::text::numeric, 0),
    'wd_min', coalesce((public._setting('withdraw_min'))::text::numeric, 20),
    'wd_max', coalesce((public._setting('withdraw_max'))::text::numeric, 0));
$$;
grant execute on function public.money_limits() to anon, authenticated;

create or replace function public._money_check(p_kind text, p_amount numeric) returns void
language plpgsql stable security definer set search_path = public as $$
declare l jsonb := public.money_limits(); v_min numeric; v_max numeric;
  v_name text := case p_kind when 'dep' then 'Depósito' else 'Saque' end;
begin
  v_min := (l->>(p_kind || '_min'))::numeric; v_max := (l->>(p_kind || '_max'))::numeric;
  if p_amount is null or p_amount < v_min then raise exception '% mínimo: %', v_name, public._brl(v_min); end if;
  if v_max > 0 and p_amount > v_max then raise exception '% máximo: %', v_name, public._brl(v_max); end if;
end $$;

CREATE OR REPLACE FUNCTION public.request_deposit(p_amount numeric)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_user uuid := public._me(); v_id bigint; l public.user_limits; v_sum numeric;
begin
  perform public._money_check('dep', p_amount);
  l := public._limits(v_user);
  if l.user_id is not null then
    if l.self_excluded_until > now() then raise exception 'Conta em pausa: depósitos bloqueados'; end if;
    select coalesce(sum(amount) filter (where created_at > now() - interval '1 day'), 0) into v_sum from public.transactions
     where user_id = v_user and type = 'deposit' and status in ('pending','done');
    if l.deposit_day is not null and v_sum + p_amount > l.deposit_day then raise exception 'Limite diário de depósito: R$ %', l.deposit_day; end if;
    select coalesce(sum(amount), 0) into v_sum from public.transactions
     where user_id = v_user and type = 'deposit' and status in ('pending','done') and created_at > now() - interval '7 days';
    if l.deposit_week is not null and v_sum + p_amount > l.deposit_week then raise exception 'Limite semanal de depósito: R$ %', l.deposit_week; end if;
    select coalesce(sum(amount), 0) into v_sum from public.transactions
     where user_id = v_user and type = 'deposit' and status in ('pending','done') and created_at > now() - interval '30 days';
    if l.deposit_month is not null and v_sum + p_amount > l.deposit_month then raise exception 'Limite mensal de depósito: R$ %', l.deposit_month; end if;
  end if;
  insert into public.transactions (user_id, type, amount, status, description)
  values (v_user, 'deposit', round(p_amount, 2), 'pending', 'Depósito PIX') returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.request_withdraw(p_amount numeric)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_user uuid := public._me(); v_id bigint; v_c text[]; v_today numeric; v_left numeric;
  v_max numeric := coalesce((public._setting('withdraw_daily_max'))::text::numeric, 0);
begin
  perform public._money_check('wd', p_amount);
  perform public._expire_bonuses(v_user);
  select sum(wager_required - wagered) into v_left from public.user_bonuses where user_id = v_user and status = 'ativo';
  if v_left > 0 then raise exception 'Cumpra o rollover do bônus antes de sacar: faltam R$ % em apostas (ou cancele o bônus em Minha conta → Bônus)', round(v_left, 2); end if;
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
end $function$;

-- Coloca o aviso do saque na fila de e-mails (enviada pela função ops-tick a cada minuto, via Resend).
create or replace function public._withdraw_email(p_tx bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_to text := trim(coalesce(public._setting('withdraw_alert_email') #>> '{}', '')); t public.transactions; p public.profiles;
begin
  if v_to = '' then return; end if;
  select * into t from public.transactions where id = p_tx and type = 'withdraw';
  if not found then return; end if;
  select * into p from public.profiles where id = t.user_id;
  insert into public.email_outbox (to_email, subject, body, ref)
  values (v_to,
    format('Pedido de saque de %s no Real Sports (#%s)', public._brl(abs(t.amount)), t.id),
    format(E'Novo pedido de saque.\n\nJogador: %s (%s)\nValor: %s\nChave PIX (%s): %s\nAnálise: %s%s\nSaldo restante: %s\nData: %s\n\nAprovar ou recusar: https://realsports.online/admin.html\n',
      coalesce(nullif(p.full_name, ''), p.username, '-'), coalesce(p.email, t.user_id::text), public._brl(abs(t.amount)),
      coalesce(t.pix_key_type, '-'), coalesce(t.pix_key, '-'), coalesce(t.review_level, '-'),
      coalesce(' (' || t.review_notes || ')', ''), public._brl(coalesce(p.balance, 0)),
      to_char(t.created_at at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI')),
    'wd:' || t.id)
  on conflict (ref) do nothing;
end $$;
revoke all on function public._withdraw_email(bigint) from public, anon, authenticated;

create or replace function public.request_withdraw(p_amount numeric, p_pix_key text, p_pix_type text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_key text := public._pix_key_ok(p_pix_key, p_pix_type); v_id bigint; v_cpf text;
begin
  select cpf into v_cpf from public.profiles where id = public._me();
  if v_cpf is null then raise exception 'Cadastre seu CPF antes de sacar'; end if;
  if p_pix_type = 'cpf' and v_key <> v_cpf then
    raise exception 'A chave PIX CPF precisa ser o CPF cadastrado na sua conta';
  end if;
  v_id := public.request_withdraw(p_amount);
  update public.transactions set pix_key = v_key, pix_key_type = p_pix_type,
         payout_status = case when public._withdraw_auto_ok(review_level, amount) then 'queued' end
   where id = v_id;
  perform public._withdraw_email(v_id);
  return v_id;
end $$;
