-- Trava de gol pela ESPN (2ª fonte de placar): a Edge Function goal-guard roda a cada 5 s e,
-- quando a ESPN já mostra mais gols que o jogo ao vivo, trava apostas e cashout até a API-Football confirmar.
create table if not exists public.goal_guard (
  match_id bigint primary key references public.matches(id) on delete cascade,
  espn_id text,
  espn_home int not null,
  espn_away int not null,
  first_at timestamptz not null default now()
);
alter table public.goal_guard enable row level security;

create or replace function public._call_goal_guard()
returns bigint language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/goal-guard',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)
$$;
revoke all on function public._call_goal_guard() from public, anon, authenticated;

select cron.schedule('goal-guard', '5 seconds', 'select public._call_goal_guard()');
