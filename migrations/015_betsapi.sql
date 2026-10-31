-- 015: BetsAPI (feed Betfair Sportsbook) como fonte de odds/placar ao vivo (ODDS_PROVIDER=betsapi, secret BETSAPI_TOKEN)
-- ao vivo a cada 20 s (a função só consulta a API quando há jogo em andamento; limite do plano: por hora)
select cron.unschedule('sync-odds-live') where exists (select 1 from cron.job where jobname = 'sync-odds-live');
select cron.schedule('sync-odds-live', '20 seconds', $$select public._call_sync_odds('live')$$);

-- jogos das APIs antigas sem apostas pendentes saem do catálogo; os novos têm external_id "bf<liga>:<id>"
update public.matches m set status = 'canceled'
 where m.status in ('open', 'live') and m.external_id is not null and m.external_id not like 'bf%'
   and not exists (select 1 from public.bet_selections s where s.match_id = m.id and s.status = 'pending');

-- busca completa a cada hora (cada execução tem prazo e cobre parte dos jogos mais distantes)
select cron.unschedule('sync-odds-full') where exists (select 1 from cron.job where jobname = 'sync-odds-full');
select cron.schedule('sync-odds-full', '7 * * * *', $$select public._call_sync_odds('full')$$);
