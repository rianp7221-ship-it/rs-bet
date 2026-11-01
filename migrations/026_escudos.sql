-- escudos dos times e logo da liga (URLs da API-Football)
alter table public.matches add column if not exists home_logo text, add column if not exists away_logo text, add column if not exists league_logo text;
