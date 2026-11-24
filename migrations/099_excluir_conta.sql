-- Excluir conta: apaga o login e os dados pessoais, mantendo bilhetes e transações no financeiro.
-- (apagar auth.users/profiles levaria junto, em cascata, todo o histórico de dinheiro)
create or replace function public._delete_account(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_mail text := 'excluida-' || p_user::text || '@conta.excluida';
begin
  if not exists (select 1 from public.profiles where id = p_user) then raise exception 'Usuário não encontrado'; end if;
  update auth.users set email = v_mail, phone = null, encrypted_password = '', raw_user_meta_data = '{}'::jsonb,
    banned_until = 'infinity' where id = p_user;
  delete from auth.identities where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  delete from public.push_subscriptions where user_id = p_user;
  update public.profiles set email = v_mail, username = 'Conta excluída', full_name = null, cpf = null,
    last_ip = null, asaas_customer_id = null, blocked = true where id = p_user;
  perform public._audit('usuario.excluir', 'profile', p_user::text, p_reason, null, jsonb_build_object('excluida', true));
end $$;
revoke all on function public._delete_account(uuid, text) from public, anon, authenticated;

create or replace function public.admin_delete_account(p_user uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._require_perm('users.block');
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Informe o motivo da exclusão'; end if;
  if p_user = auth.uid() then raise exception 'Você não pode excluir a sua própria conta'; end if;
  if exists (select 1 from public.profiles where id = p_user and (is_admin or staff_role is not null)) then
    raise exception 'Tire a conta da equipe antes de excluir'; end if;
  perform public._delete_account(p_user, p_reason);
end $$;
revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;
