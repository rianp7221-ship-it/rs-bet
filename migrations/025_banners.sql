-- Banners do Início, gerenciados no Admin (Bônus e marketing → Banners)
create table if not exists public.banners (
  id bigserial primary key,
  title text not null check (length(title) between 1 and 80),
  subtitle text check (length(subtitle) <= 160),
  cta text check (length(cta) <= 30),
  link text check (length(link) <= 300),
  theme text not null default 'orange' check (theme in ('orange','navy','green','purple','dark')),
  icon text not null default 'ball',
  image_url text check (length(image_url) <= 500),
  sort int not null default 0,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.banners enable row level security;
drop policy if exists banners_read on public.banners;
create policy banners_read on public.banners for select
  using ((active and (starts_at is null or starts_at <= now()) and (ends_at is null or ends_at > now())) or public.has_perm('bonus.view'));
grant select on public.banners to anon, authenticated;

create or replace function public.admin_save_banner(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_before jsonb; v_row public.banners;
begin
  perform public._require_perm('bonus.manage');
  if v_id is null then
    insert into public.banners (title, subtitle, cta, link, theme, icon, image_url, sort, active, starts_at, ends_at)
    values (p->>'title', nullif(p->>'subtitle', ''), nullif(p->>'cta', ''), nullif(p->>'link', ''), coalesce(nullif(p->>'theme', ''), 'orange'),
            coalesce(nullif(p->>'icon', ''), 'ball'), nullif(p->>'image_url', ''),
            coalesce((p->>'sort')::int, (select coalesce(max(sort), 0) + 1 from public.banners)), coalesce((p->>'active')::boolean, true),
            nullif(p->>'starts_at', '')::timestamptz, nullif(p->>'ends_at', '')::timestamptz)
    returning * into v_row;
  else
    select to_jsonb(b) into v_before from public.banners b where id = v_id;
    if v_before is null then raise exception 'Banner não encontrado'; end if;
    update public.banners set
      title = coalesce(p->>'title', title), subtitle = case when p ? 'subtitle' then nullif(p->>'subtitle', '') else subtitle end,
      cta = case when p ? 'cta' then nullif(p->>'cta', '') else cta end, link = case when p ? 'link' then nullif(p->>'link', '') else link end,
      theme = coalesce(nullif(p->>'theme', ''), theme), icon = coalesce(nullif(p->>'icon', ''), icon),
      image_url = case when p ? 'image_url' then nullif(p->>'image_url', '') else image_url end,
      sort = coalesce((p->>'sort')::int, sort), active = coalesce((p->>'active')::boolean, active),
      starts_at = case when p ? 'starts_at' then nullif(p->>'starts_at', '')::timestamptz else starts_at end,
      ends_at = case when p ? 'ends_at' then nullif(p->>'ends_at', '')::timestamptz else ends_at end,
      updated_at = now()
    where id = v_id returning * into v_row;
  end if;
  perform public._audit(case when v_id is null then 'banner.criar' else 'banner.editar' end, 'banner', v_row.id::text, null, v_before, to_jsonb(v_row));
  return v_row.id;
end $$;

create or replace function public.admin_delete_banner(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_before jsonb;
begin
  perform public._require_perm('bonus.manage');
  select to_jsonb(b) into v_before from public.banners b where id = p_id;
  delete from public.banners where id = p_id;
  perform public._audit('banner.excluir', 'banner', p_id::text, null, v_before, null);
end $$;
revoke all on function public.admin_save_banner(jsonb), public.admin_delete_banner(bigint) from public, anon;
grant execute on function public.admin_save_banner(jsonb), public.admin_delete_banner(bigint) to authenticated;

-- imagens dos banners: leitura pública, envio só por quem gerencia marketing
do $do$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    execute $q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      values ('banners', 'banners', true, 3145728, array['image/jpeg','image/png','image/webp']) on conflict (id) do nothing$q$;
    execute 'drop policy if exists "banners_write" on storage.objects';
    execute $q$create policy "banners_write" on storage.objects for insert to authenticated
      with check (bucket_id = 'banners' and public.has_perm('bonus.manage'))$q$;
    execute 'drop policy if exists "banners_manage_read" on storage.objects';
    execute $q$create policy "banners_manage_read" on storage.objects for select to authenticated
      using (bucket_id = 'banners' and public.has_perm('bonus.manage'))$q$;
    execute 'drop policy if exists "banners_delete" on storage.objects';
    execute $q$create policy "banners_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'banners' and public.has_perm('bonus.manage'))$q$;
  end if;
end $do$;

-- banners iniciais da Real Sports
insert into public.banners (title, subtitle, cta, link, theme, icon, sort)
select * from (values
  ('As melhores odds do Brasil', 'Mais de 50 ligas com odds turbinadas todos os dias.', 'Ver jogos', 'view:all', 'orange', 'star', 1),
  ('Cash out ao vivo', 'Encerre sua aposta quando quiser, com o valor atualizado em tempo real.', 'Apostar ao vivo', 'view:live', 'navy', 'live', 2),
  ('Criar Aposta', 'Junte resultado, gols e ambas marcam do mesmo jogo numa seleção só.', 'Criar agora', 'view:all', 'purple', 'ball', 3),
  ('Saque rápido no PIX', 'Depósito na hora e saque direto na sua chave PIX.', 'Depositar', 'deposit', 'green', 'wallet', 4)
) v(title, subtitle, cta, link, theme, icon, sort)
where not exists (select 1 from public.banners);
