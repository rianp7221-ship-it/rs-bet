-- Basquete (NBA, EuroLeague): odds da The Odds API e placar da API-Basketball, pelo sync-odds { mode: "basket" }.
-- Os jogos de basquete (external_id "bk...") convivem com os da fonte principal: sync_orphan_matches não fecha esses jogos.
drop function if exists public.sync_orphan_matches(text);
create or replace function public.sync_orphan_matches(p_prefix text, p_keep text default 'bk')
returns integer language plpgsql security definer set search_path = public as $$
declare o public.matches; t public.matches; v_n int := 0;
begin
  if coalesce(p_prefix, '') = '' then return 0; end if;
  update public.matches m set status = case when exists (select 1 from public.bet_selections s where s.match_id = m.id and s.status = 'pending')
                                          then 'closed' else 'canceled' end
   where m.status in ('open', 'live') and m.external_id is not null and m.external_id not like p_prefix || '%'
     and (p_keep is null or m.external_id not like p_keep || '%');
  for o in select * from public.matches where status = 'closed' and external_id is not null and external_id not like p_prefix || '%'
             and (p_keep is null or external_id not like p_keep || '%') loop
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
revoke all on function public.sync_orphan_matches(text, text) from public, anon, authenticated;

select cron.schedule('sync-odds-basket', '7,22,37,52 * * * *', $$select public._call_sync_odds('basket')$$);
