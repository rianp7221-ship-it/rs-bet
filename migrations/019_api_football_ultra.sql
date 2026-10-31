-- API-Football Ultra (75 mil consultas/dia): ao vivo a cada 10 s
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.alter_job(jobid, schedule := '10 seconds') from cron.job where jobname = 'sync-odds-live';
  end if;
end $$;
