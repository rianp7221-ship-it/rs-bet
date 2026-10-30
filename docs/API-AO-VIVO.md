# Jogos ao vivo, cashout e troca de API

## Como funciona
- `sync-odds` (Edge Function) busca jogos, odds e placares na API configurada. O pg_cron chama no modo `live` a cada 2 min e no modo `full` a cada 6 h (`migrations/003_sync_automatico.sql`).
- `live-events` (Edge Function) recebe eventos em tempo real de qualquer API: `danger`, `suspend`, `resume`, `goal`/`score`, `odds`.
- O banco decide a suspensão (`migrations/002_cashout_ao_vivo.sql`, função `_suspension`). Apostas e cashout ficam bloqueados quando:
  - o admin suspendeu o jogo (`matches.locked`);
  - `suspended_until` está no futuro: gol no futebol/hóquei (90 s), odd variando mais de 15% (30 s), mercado sumiu da API (60 s) ou evento `danger` (20 s);
  - um jogo ao vivo da API está sem atualização há mais de 4 min.
- `cashout_bet` ao vivo espera 4 s e cota de novo antes de pagar.

## Trocar de API
1. Em `supabase/functions/_shared/providers.ts`, crie um adaptador que implemente `OddsProvider` (`odds(sport)`, `scores(sport)`, `remaining()`) e registre em `PROVIDERS`.
2. Nos secrets das Edge Functions: `ODDS_PROVIDER=<nome>`, `ODDS_API_KEY=<chave>` e, se quiser, `ODDS_SPORTS=<ligas>`.
3. Se a nova API mandar eventos ao vivo (ataque perigoso, gol), aponte o webhook dela, ou um adaptador, para:
   `POST https://pscpcxleyysspvwkevpe.supabase.co/functions/v1/live-events` com o header `x-cron-secret: <CRON_SECRET>` e o corpo
   `{"events":[{"external_id":"<sport_key>:<id>","type":"danger","seconds":20}]}`
4. Publique: `supabase functions deploy sync-odds live-events --project-ref pscpcxleyysspvwkevpe --use-api --no-verify-jwt`
