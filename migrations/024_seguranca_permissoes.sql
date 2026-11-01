-- Defesa extra: visitantes sem login (anon) não executam funções do Admin nem RPCs que exigem conta.
-- As funções já conferem permissão por dentro (has_perm/_me); isto fecha a porta antes.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
             and (p.proname like 'admin\_%' or p.proname in ('request_withdraw', 'request_deposit', 'cashout_bet', 'cashout_value',
                  'cashout_quote', 'cashout_request', 'cashout_confirm', 'cashout_reason', 'place_bet', 'set_my_limits', 'kyc_submit',
                  'my_last_pix_key', 'log_login', 'set_my_cpf'))
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;
