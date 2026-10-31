-- Cashout mais rápido: minuto de jogo, ao vivo a cada 15 s e trava se o jogo ficar sem atualização por 90 s
alter table public.matches add column if not exists minute int;

create or replace function public._suspension(m public.matches) returns text
language sql stable as $$
  select case
    when m.locked then 'Suspenso pelo operador'
    when m.suspended_until > now() then coalesce(m.suspend_reason, 'Suspenso')
    when m.external_id is not null and (m.status = 'live' or m.starts_at <= now())
         and (m.synced_at is null or m.synced_at < now() - interval '90 seconds') then 'Aguardando atualização do jogo'
  end
$$;
revoke execute on function public._suspension(public.matches) from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, schedule := '15 seconds') from cron.job where jobname = 'sync-odds-live';
  end if;
end $$;
