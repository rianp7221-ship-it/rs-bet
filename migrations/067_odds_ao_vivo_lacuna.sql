-- =====================================================
--  067 — Última leitura real das odds ao vivo (odds_seen_at).
--        O /odds/live às vezes vem parcial; o sync-odds segura as últimas odds
--        por até 2 min em vez de fechar todos os jogos juntos.
-- =====================================================
alter table public.matches add column if not exists odds_seen_at timestamptz;
update public.matches set odds_seen_at = odds_at where status = 'live' and odds_seen_at is null;
