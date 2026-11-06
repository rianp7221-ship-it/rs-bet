-- id do jogo no 365Scores (goal-guard): o painel "Acompanhar" do bilhete busca campinho, estatísticas e lances direto do 365Scores
alter table public.matches add column if not exists ext365_id bigint;
