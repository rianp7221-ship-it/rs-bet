-- CPF do titular: cadastrado uma vez pelo jogador e exigido no saque PIX
alter table public.profiles add column if not exists cpf text unique;

create or replace function public._cpf_ok(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return null; end if;
  for k in 9..10 loop
    s := 0;
    for i in 1..k loop s := s + substr(d, i, 1)::int * (k + 2 - i); end loop;
    r := (s * 10) % 11; if r = 10 then r := 0; end if;
    if r <> substr(d, k + 1, 1)::int then return null; end if;
  end loop;
  return d;
end $$;

create or replace function public.set_my_cpf(p_cpf text) returns text
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_cpf text := public._cpf_ok(p_cpf);
begin
  if v_cpf is null then raise exception 'CPF inválido'; end if;
  if exists (select 1 from public.profiles where id = v_user and cpf is not null) then
    raise exception 'O CPF já está cadastrado. Para corrigir, fale com o suporte.';
  end if;
  if exists (select 1 from public.profiles where cpf = v_cpf) then raise exception 'Este CPF já está em outra conta'; end if;
  update public.profiles set cpf = v_cpf where id = v_user;
  return v_cpf;
end $$;
revoke all on function public.set_my_cpf(text) from public, anon;
grant execute on function public.set_my_cpf(text) to authenticated;

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
  return v_id;
end $$;
