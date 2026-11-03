-- Menos IO de disco: o sync-odds regrava todos os jogos a cada rodada mesmo sem mudança.
-- Pula UPDATE que só renova synced_at/odds_at; em jogo começado renova no máximo a cada 15 s
-- (o _suspension trava após live_stale_secs, mínimo 15 s, sem atualização).
create or replace function public._matches_skip_noop() returns trigger
language plpgsql as $$
begin
  if (to_jsonb(new) - 'synced_at' - 'odds_at') = (to_jsonb(old) - 'synced_at' - 'odds_at')
     and (not (old.status = 'live' or old.starts_at <= now())
          or (old.synced_at > now() - interval '15 seconds'
              and (new.odds_at is not distinct from old.odds_at or old.odds_at > now() - interval '15 seconds'))) then
    return null;
  end if;
  return new;
end $$;
drop trigger if exists a_skip_noop on public.matches;
create trigger a_skip_noop before update on public.matches for each row execute function public._matches_skip_noop();

-- contador da cota da API: grava no máximo 1 vez por minuto
create or replace function public._settings_feed_throttle() returns trigger
language plpgsql as $$
begin
  if old.key like 'feed\_%' and old.updated_at > now() - interval '60 seconds' then return null; end if;
  return new;
end $$;
drop trigger if exists a_feed_throttle on public.settings;
create trigger a_feed_throttle before update on public.settings for each row execute function public._settings_feed_throttle();

-- histórico do pg_cron (um registro a cada 5–10 s) só do último dia
select cron.schedule('cleanup-cron-log', '7 * * * *', $$delete from cron.job_run_details where end_time < now() - interval '1 day'$$);
