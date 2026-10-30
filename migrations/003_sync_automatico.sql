-- ---------- SINCRONIZAÇÃO AUTOMÁTICA (pg_cron + pg_net) ----------
-- Antes: crie o secret CRON_SECRET nas Edge Functions e o mesmo valor no Vault:
--   select vault.create_secret('<mesmo valor do CRON_SECRET>', 'sync_odds_cron_secret');
-- Publique as funções com --no-verify-jwt (elas fazem a própria autenticação).
create extension if not exists pg_cron;
create extension if not exists pg_net;

create or replace function public._call_sync_odds(p_mode text) returns bigint
language sql security definer set search_path = public as $$
  select net.http_post(
    url := 'https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/sync-odds',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sync_odds_cron_secret')),
    body := jsonb_build_object('mode', p_mode),
    timeout_milliseconds := 60000)
$$;
revoke execute on function public._call_sync_odds(text) from public, anon, authenticated;

-- ao vivo a cada 2 min (com API paga dá para usar '* * * * *'); todos os jogos a cada 6 h
select cron.schedule('sync-odds-live', '*/2 * * * *', $$select public._call_sync_odds('live')$$);
select cron.schedule('sync-odds-full', '0 */6 * * *', $$select public._call_sync_odds('full')$$);
