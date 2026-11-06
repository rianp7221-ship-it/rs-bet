-- relógio exato do jogo vindo do 365Scores (goal-guard, a cada 5 s): segundos de jogo em clock_at; a tela conta a partir daí
alter table public.matches add column if not exists clock_secs int, add column if not exists clock_at timestamptz;
