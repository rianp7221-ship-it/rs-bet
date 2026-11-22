-- Placar ao vivo do 365Scores (chega ~40 s antes da API-Football): o goal-guard grava, o site mostra.
-- Só exibição: travas, odds e liquidação continuam pelo score_home/score_away da API-Football.
alter table public.matches add column if not exists score365_home smallint, add column if not exists score365_away smallint;
