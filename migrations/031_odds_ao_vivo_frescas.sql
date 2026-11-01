-- Jogo ao vivo só aceita aposta/cashout com odds vindas do feed ao vivo há pouco tempo.
-- Antes, sem 1X2 no /odds/live, o jogo ficava com as odds de pré-jogo (ex.: 0 x 9 pagando 1.49 para quem goleava).
alter table public.matches add column if not exists odds_at timestamptz;

create or replace function public._suspension(m public.matches) returns text
language sql stable as $$
  select case
    when m.locked then 'Suspenso pelo operador'
    when m.suspended_until > now() then coalesce(m.suspend_reason, 'Suspenso')
    when m.external_id is not null and (m.status = 'live' or m.starts_at <= now())
         and (m.synced_at is null or m.synced_at < now()
              - make_interval(secs => greatest(coalesce((public._setting('live_stale_secs'))::text::int, 30), 15)))
      then 'Aguardando atualização do jogo'
    when m.external_id is not null and (m.status = 'live' or m.starts_at <= now())
         and (m.odds_at is null or m.odds_at < now()
              - make_interval(secs => greatest(coalesce((public._setting('live_stale_secs'))::text::int, 30), 15)))
      then 'Sem odds ao vivo'
  end
$$;
revoke execute on function public._suspension(public.matches) from public, anon, authenticated;
