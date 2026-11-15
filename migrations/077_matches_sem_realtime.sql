-- O site busca os jogos ao vivo por consulta curta (sports.js pollLive); a tabela matches sai do Realtime,
-- que mandava 1 mensagem por linha alterada para cada jogador conectado (~1 milhão/dia, cota do Pro: 5 milhões/mês).
-- Aplicar só depois do merge do frontend.
do $$ begin
  if exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'matches') then
    alter publication supabase_realtime drop table public.matches;
  end if;
end $$;
