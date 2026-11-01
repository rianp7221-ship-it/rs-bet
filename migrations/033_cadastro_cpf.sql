-- Cadastro exige CPF válido e único + nome completo; contas antigas sem CPF completam pelo site
alter table public.profiles add column if not exists full_name text;

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
          coalesce(nullif(new.raw_user_meta_data->>'username', ''), split_part(new.email, '@', 1)),
          lower(new.email) = 'rianp7221@gmail.com', v_ref, v_aff, v_cpf, left(v_name, 120))
  on conflict (id) do nothing;
  return new;
end $$;

-- CPF já em outra conta, consultável antes do cadastro (só sim/não, sem dados da conta)
create or replace function public.cpf_available(p_cpf text)
returns boolean language sql stable security definer set search_path = public as $$
  select public._cpf_ok(p_cpf) is not null
     and not exists (select 1 from public.profiles where cpf = public._cpf_ok(p_cpf));
$$;
grant execute on function public.cpf_available(text) to anon, authenticated;

-- contas antigas: completa CPF e nome uma única vez
create or replace function public.set_my_identity(p_cpf text, p_name text)
returns void language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); p public.profiles;
  v_name text := nullif(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  select * into p from public.profiles where id = v_user;
  if p.cpf is null then perform public.set_my_cpf(p_cpf); end if;
  if p.full_name is null then
    if v_name is null or v_name !~ '\S+\s+\S+' then raise exception 'Informe o nome completo'; end if;
    update public.profiles set full_name = left(v_name, 120) where id = v_user;
  end if;
end $$;
revoke execute on function public.set_my_identity(text, text) from public, anon;
grant execute on function public.set_my_identity(text, text) to authenticated;
