-- Tema do site escolhido no admin (Configurações → Tema do site): "classico" (laranja) ou "verde" (verde e amarelo).
insert into public.settings (key, value, label) values ('site_theme', '"classico"', 'Tema do site')
on conflict (key) do nothing;
drop policy if exists settings_theme_read on public.settings;
-- o site lê o tema antes do login, sem abrir a tabela settings
create or replace function public.site_theme() returns text
language sql stable security definer set search_path = public
as $$ select coalesce((select value #>> '{}' from public.settings where key = 'site_theme'), 'classico') $$;
revoke all on function public.site_theme() from public;
grant execute on function public.site_theme() to anon, authenticated;
