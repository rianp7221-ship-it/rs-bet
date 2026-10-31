-- Jogos importados por uma fonte antiga (ex.: BetsAPI "bf…", The Odds API "soccer_…") deixam de ser
-- atualizados quando a fonte muda e ficavam "ao vivo" para sempre. Agora:
--   * saem do catálogo (canceled sem apostas pendentes; closed com apostas pendentes);
--   * os closed são liquidados com o placar do mesmo jogo na fonte atual (mesmo horário ±30 min e nome de time em comum).

create or replace function public._team_tokens(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(t), '{}') from regexp_split_to_table(
    translate(lower(coalesce(p, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'), '[^a-z0-9]+') t
   where length(t) >= 4 and t not in ('city', 'united', 'town', 'club', 'real', 'sporting', 'athletic', 'atletico')
$$;

create or replace function public.sync_orphan_matches(p_prefix text) returns int
language plpgsql security definer set search_path = public as $$
declare o public.matches; t public.matches; v_n int := 0;
begin
  if coalesce(p_prefix, '') = '' then return 0; end if;
  update public.matches m set status = case when exists (select 1 from public.bet_selections s where s.match_id = m.id and s.status = 'pending')
                                          then 'closed' else 'canceled' end
   where m.status in ('open', 'live') and m.external_id is not null and m.external_id not like p_prefix || '%';
  for o in select * from public.matches where status = 'closed' and external_id is not null and external_id not like p_prefix || '%' loop
    select * into t from public.matches x
     where x.external_id like p_prefix || '%' and x.status = 'settled' and x.result is not null
       and abs(extract(epoch from x.starts_at - o.starts_at)) <= 1800
       and (public._team_tokens(x.home) && public._team_tokens(o.home) or public._team_tokens(x.away) && public._team_tokens(o.away))
     order by abs(extract(epoch from x.starts_at - o.starts_at)) limit 1;
    if not found then continue; end if;
    update public.matches set score_home = t.score_home, score_away = t.score_away where id = o.id;
    perform public.settle_match(o.id, t.result);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.sync_orphan_matches(text) from public, anon, authenticated;
grant execute on function public.sync_orphan_matches(text) to service_role;
