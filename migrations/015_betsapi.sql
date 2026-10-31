-- 015: BetsAPI (feed Betfair Sportsbook) como fonte de odds/placar ao vivo (ODDS_PROVIDER=betsapi, secret BETSAPI_TOKEN)
-- ao vivo a cada 30 s (cada rodada pode levar 5–45 s nessa API; a função só consulta a API quando há jogo em andamento; limite do plano: por hora)
select cron.unschedule('sync-odds-live') where exists (select 1 from cron.job where jobname = 'sync-odds-live');
select cron.schedule('sync-odds-live', '30 seconds', $$select public._call_sync_odds('live')$$);

-- jogos das APIs antigas sem apostas pendentes saem do catálogo; os novos têm external_id "bf<liga>:<id>"
update public.matches m set status = 'canceled'
 where m.status in ('open', 'live') and m.external_id is not null and m.external_id not like 'bf%'
   and not exists (select 1 from public.bet_selections s where s.match_id = m.id and s.status = 'pending');

-- busca completa a cada hora (cada execução tem prazo e cobre parte dos jogos mais distantes)
select cron.unschedule('sync-odds-full') where exists (select 1 from cron.job where jobname = 'sync-odds-full');
select cron.schedule('sync-odds-full', '7 * * * *', $$select public._call_sync_odds('full')$$);

-- a busca completa nessa API leva até ~2 min: espera a resposta por até 150 s
create or replace function public._call_sync_odds(p_mode text) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/sync-odds',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 150000)
$$;
revoke execute on function public._call_sync_odds(text) from public, anon, authenticated;
