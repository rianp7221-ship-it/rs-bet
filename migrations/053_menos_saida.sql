-- =====================================================
--  053 — Menos saída de dados (egress) do Supabase
--  matches.n_markets = nº de mercados extras (a lista do site não baixa mais o jsonb markets).
--  Tempo real de matches sem a coluna markets: cada atualização do sync deixa de mandar o jsonb para todos os clientes.
-- =====================================================
alter table public.matches add column if not exists n_markets int not null default 0;

create or replace function public._matches_nmk() returns trigger
language plpgsql set search_path = public as $$
begin
  new.n_markets := coalesce((select count(*) from jsonb_object_keys(coalesce(new.markets, '{}'::jsonb))), 0);
  return new;
end $$;
drop trigger if exists matches_nmk on public.matches;
create trigger matches_nmk before insert or update of markets on public.matches
  for each row execute function public._matches_nmk();
update public.matches set n_markets = (select count(*) from jsonb_object_keys(coalesce(markets, '{}'::jsonb)))
 where status in ('open', 'live');

alter publication supabase_realtime drop table public.matches;
alter publication supabase_realtime add table public.matches
  (id, external_id, sport, league, home, away, starts_at, odd_home, odd_draw, odd_away, status, result, score_home, score_away,
   created_at, synced_at, locked, suspended_until, suspend_reason, minute, bb_lh, bb_la, home_logo, away_logo, league_logo,
   odds_at, n_markets);
