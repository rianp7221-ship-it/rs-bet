-- 014: API-Football como fonte de odds/placar ao vivo (ODDS_PROVIDER=apifootball)
-- ao vivo a cada 20 s (a função só consulta a API quando há jogo em andamento)
select cron.unschedule('sync-odds-live') where exists (select 1 from cron.job where jobname = 'sync-odds-live');
select cron.schedule('sync-odds-live', '20 seconds', $$select public._call_sync_odds('live')$$);

-- jogos da API antiga (The Odds API) sem apostas pendentes saem do catálogo; os novos têm external_id "af<liga>:<id>"
update public.matches m set status = 'canceled'
 where m.status in ('open', 'live') and m.external_id is not null and m.external_id not like 'af%'
   and not exists (select 1 from public.bet_selections s where s.match_id = m.id and s.status = 'pending');
