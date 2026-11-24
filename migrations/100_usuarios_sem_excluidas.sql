-- lista de Usuários: contas excluídas nunca aparecem (bilhetes e transações seguem no financeiro)
CREATE OR REPLACE FUNCTION public.admin_search_users(p_q text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_risk text DEFAULT NULL::text, p_min_balance numeric DEFAULT NULL::numeric, p_max_balance numeric DEFAULT NULL::numeric, p_country text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_order text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  perform public._require_perm('users.view');
  with base as (
    select p.*,
      (select coalesce(sum(amount), 0) from public.transactions t where t.user_id = p.id and t.type = 'deposit' and t.status = 'done') as deposits,
      (select count(*) from public.bets b where b.user_id = p.id) as bets_count,
      (select l.self_excluded_until > now() from public.user_limits l where l.user_id = p.id) as excluded
    from public.profiles p
    where (p_q is null or p_q = '' or p.email ilike '%' || p_q || '%' or p.username ilike '%' || p_q || '%' or p.id::text = p_q or p.last_ip = p_q)
      and (p_status is null or p_status = '' or (p_status = 'bloqueado' and p.blocked) or (p_status = 'ativo' and not p.blocked)
           or (p_status = 'equipe' and (p.is_admin or p.staff_role is not null)))
      and p.email not like '%@conta.excluida'
      and (p_risk is null or p_risk = '' or p.risk_level = p_risk)
      and (p_min_balance is null or p.balance >= p_min_balance)
      and (p_max_balance is null or p.balance <= p_max_balance)
      and (p_country is null or p_country = '' or p.country = upper(p_country))),
  pg as (
    select id, email, username, balance, blocked, risk_level, country, staff_role,
      is_admin, created_at, last_login_at, last_ip, deposits, bets_count, coalesce(excluded, false) as excluded,
      row_number() over (order by case when p_order = 'saldo' then balance end desc nulls last, created_at desc) as rn
    from base)
  select jsonb_build_object('total', (select count(*) from base),
    'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'is_admin' - 'rn' order by x.rn) from (select * from pg
                     order by rn limit least(p_limit, 200) offset p_offset) x), '[]'))
  into v;
  return v;
end $function$;
