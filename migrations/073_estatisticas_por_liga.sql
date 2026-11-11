-- Escanteios, cartões e chutes só nas ligas em que alguma fonte tem o dado final (senão as apostas acabam anuladas).
-- league_stats é preenchida pelo sync-odds (365Scores + histórico de jogos liquidados); liga sem linha = sem esses mercados.
create table if not exists public.league_stats (
  league text primary key,
  corners boolean not null default false,
  cards boolean not null default false,
  shots boolean not null default false,
  checked_at timestamptz not null default now()
);
alter table public.league_stats enable row level security;

-- antes do a_skip_noop: o mesmo mercado reenviado pelo feed continua igual ao que está salvo e a escrita é pulada
create or replace function public._stat_markets() returns trigger
language plpgsql set search_path = public as $$
declare ls public.league_stats;
begin
  if new.markets is null then return new; end if;
  select * into ls from public.league_stats where league = new.league;
  if ls.corners and ls.cards and ls.shots then return new; end if;
  new.markets := coalesce((select jsonb_object_agg(k, v) from jsonb_each(new.markets) e(k, v)
    where case public._bb_family(k) when 'c' then coalesce(ls.corners, false) when 'k' then coalesce(ls.cards, false)
                                    when 's' then coalesce(ls.shots, false) else true end), '{}'::jsonb);
  return new;
end $$;
drop trigger if exists a0_stat_markets on public.matches;
create trigger a0_stat_markets before insert or update of markets on public.matches
  for each row execute function public._stat_markets();

-- jogos já abertos: tira os mercados das ligas sem estatísticas
update public.matches set markets = markets where status in ('open', 'live') and markets is not null;
