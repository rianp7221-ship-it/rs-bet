-- Foto dos times no card grande da home: a função team-art busca no TheSportsDB (fanart do time ou recorte de jogador)
-- e guarda aqui. Antes o navegador de cada jogador buscava direto e o TheSportsDB bloqueava (429 sem CORS).
create table if not exists public.team_art (
  key text primary key,            -- "<esporte>:<nome do time>", ex.: "futebol:Flamengo"
  urls text[] not null default '{}',
  team_id text,
  checked_at timestamptz not null default now()
);
alter table public.team_art enable row level security;
drop policy if exists "team_art_read" on public.team_art;
create policy "team_art_read" on public.team_art for select to anon, authenticated using (true);
grant select on public.team_art to anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_net') then
    execute $f$
      create or replace function public._call_team_art() returns bigint
      language sql security definer set search_path = public as $q$
        select net.http_post(
          url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/team-art',
          headers := jsonb_build_object('Content-Type', 'application/json',
            'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
          body := '{}'::jsonb, timeout_milliseconds := 60000)
      $q$;
      revoke execute on function public._call_team_art() from public, anon, authenticated;
    $f$;
  end if;
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('team-art', '*/2 * * * *', 'select public._call_team_art()');
  end if;
end $$;

notify pgrst, 'reload schema';
