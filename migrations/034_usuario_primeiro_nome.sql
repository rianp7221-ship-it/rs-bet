-- Cadastro não pede mais nome de usuário: usa o primeiro nome do nome completo
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_ref uuid; v_aff bigint;
  v_cpf text := public._cpf_ok(new.raw_user_meta_data->>'cpf');
  v_name text := nullif(regexp_replace(trim(coalesce(new.raw_user_meta_data->>'full_name', '')), '\s+', ' ', 'g'), '');
begin
  if v_cpf is null then raise exception 'CPF inválido'; end if;
  if exists (select 1 from public.profiles where cpf = v_cpf) then raise exception 'Este CPF já está em outra conta'; end if;
  if v_name is null or v_name !~ '\S+\s+\S+' then raise exception 'Informe o nome completo'; end if;
  if coalesce(new.raw_user_meta_data->>'ref', '') ~ '^[0-9a-f]{8}$' then
    select id into v_ref from public.profiles where left(id::text, 8) = new.raw_user_meta_data->>'ref' limit 1;
  end if;
  select id into v_aff from public.affiliates where code = lower(coalesce(new.raw_user_meta_data->>'aff', '')) and active;
  insert into public.profiles (id, email, username, is_admin, referred_by, affiliate_id, cpf, full_name)
  values (new.id, new.email,
          coalesce(nullif(trim(new.raw_user_meta_data->>'username'), ''), left(split_part(v_name, ' ', 1), 30)),
          lower(new.email) = 'rianp7221@gmail.com', v_ref, v_aff, v_cpf, left(v_name, 120))
  on conflict (id) do nothing;
  return new;
end $$;
