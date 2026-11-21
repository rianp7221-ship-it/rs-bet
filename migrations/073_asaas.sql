-- Gateway Asaas: cliente Asaas por jogador (cobrança PIX exige CPF) e saque automático que falhou depois de enviado.
alter table public.profiles add column if not exists asaas_customer_id text;

-- Envio aceito pelo gateway, mas que depois falhou/cancelou: o saque volta para a fila manual (saldo continua retido).
create or replace function public.payout_failed(p_payout_id text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare v_t public.transactions;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Sem permissão'; end if;
  select * into v_t from public.transactions
   where payout_id = p_payout_id and type = 'withdraw' and payout_status = 'sent' and status = 'done' for update;
  if not found then return; end if;
  update public.transactions set status = 'pending', payout_status = 'failed', payout_error = left(p_reason, 300), reviewed_at = null
   where id = v_t.id;
  perform public._audit('financeiro.saque_auto_falhou', 'transaction', v_t.id::text, p_reason, to_jsonb(v_t),
                        jsonb_build_object('status', 'pending', 'payout_status', 'failed'));
  perform public._alert('saque_auto_falhou', 'alta', v_t.user_id, 'tx:' || v_t.id,
    format('Saque #%s (R$ %s) falhou no gateway depois de enviado (%s). Voltou para a fila manual.', v_t.id, abs(v_t.amount), p_reason));
end $$;
revoke execute on function public.payout_failed(text, text) from public, anon, authenticated;
grant execute on function public.payout_failed(text, text) to service_role;
