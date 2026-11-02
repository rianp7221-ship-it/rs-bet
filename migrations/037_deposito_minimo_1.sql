-- Depósito mínimo de R$ 1,00
CREATE OR REPLACE FUNCTION public.request_deposit(p_amount numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_user uuid := public._me(); v_id bigint; l public.user_limits; v_sum numeric;
begin
  if p_amount is null or p_amount < 1 then raise exception 'Depósito mínimo: R$ 1,00'; end if;
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
