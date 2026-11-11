-- Basquete pela 365Scores (odds da Bet365): total de pontos (ou + linha x10, ex. ou2225 = 222,5) e handicap
-- (hc + m/p + linha x10 da casa, ex. hcm35 = casa -3,5); pré-jogo a cada 5 min e ao vivo a cada 10 s.

alter table public.bet_selections drop constraint bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick check (
  (market = '1x2' and pick in ('home','draw','away'))
  or (market in ('ou15','ou25','ou35') and pick in ('over','under'))
  or (market = 'btts' and pick in ('yes','no'))
  or (market = 'dc' and pick in ('1x','12','x2'))
  or (market = 'dnb' and pick in ('home','away'))
  or (market = 'c1x2' and pick in ('home','draw','away'))
  or (market ~ '^co[0-9]{1,2}5$' and pick in ('over','under'))
  or (market ~ '^k[0-9]?5$' and pick in ('over','under'))
  or (market in ('s1x2','t1x2','ht1x2') and pick in ('home','draw','away'))
  or (market in ('btts1','btts2') and pick in ('yes','no'))
  or (market ~ '^(ou|hto|gh|ga|ch|ca|kh|ka|sh|sa)[0-9]{1,3}5$' and pick in ('over','under'))
  or (market ~ '^[st][0-9]{1,3}5$' and pick in ('over','under'))
  or (market = 'eg' and pick ~ '^g[0-6]$')
  or (market = 'cs' and pick ~ '^s[0-6][0-6]$')
  or (market = 'bb' and pick ~ '^[a-z0-9]+:[a-z0-9]+(\|[a-z0-9]+:[a-z0-9]+){1,12}$')
  or (market ~ '^hc[mp][0-9]{1,3}5$' and pick in ('home','away'))
) not valid;

-- settle_match liquida os demais mercados por aqui: total de pontos em qualquer linha e handicap
CREATE OR REPLACE FUNCTION public._sel_outcome(p_market text, p_pick text, h integer, a integer)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare l text; o text; v_all text := 'won';
begin
  if h is null or a is null then return 'canceled'; end if;
  if p_market = 'bb' then
    foreach l in array string_to_array(p_pick, '|') loop
      o := public._sel_outcome(split_part(l, ':', 1), split_part(l, ':', 2), h, a);
      if o = 'lost' then return 'lost'; end if;
      if o <> 'won' then v_all := 'canceled'; end if;
    end loop;
    return v_all;
  end if;
  return case
    when p_market in ('ou15','ou25','ou35') then
      case when (h + a > case p_market when 'ou15' then 1.5 when 'ou25' then 2.5 else 3.5 end) = (p_pick = 'over') then 'won' else 'lost' end
    when p_market ~ '^ou[0-9]+$' then public._ou_outcome(p_market, p_pick, h + a)
    when p_market ~ '^hc[mp][0-9]+$' then
      case when (h + case substr(p_market, 3, 1) when 'm' then -1 else 1 end * substr(p_market, 4)::numeric / 10 > a) = (p_pick = 'home')
           then 'won' else 'lost' end
    when p_market ~ '^g[ha][0-9]+$' then public._ou_outcome(p_market, p_pick, case when p_market like 'gh%' then h else a end)
    when p_market = 'eg' then case when h + a = substr(p_pick, 2)::int then 'won' else 'lost' end
    when p_market = 'cs' then case when h = substr(p_pick, 2, 1)::int and a = substr(p_pick, 3, 1)::int then 'won' else 'lost' end
    when p_market = 'btts' then case when (h > 0 and a > 0) = (p_pick = 'yes') then 'won' else 'lost' end
    when p_market = 'dc' then
      case when (p_pick = '1x' and h >= a) or (p_pick = 'x2' and h <= a) or (p_pick = '12' and h <> a) then 'won' else 'lost' end
    when p_market = 'dnb' then
      case when h = a then 'canceled' when (h > a) = (p_pick = 'home') then 'won' else 'lost' end
    else case when (case when h > a then 'home' when h < a then 'away' else 'draw' end) = p_pick then 'won' else 'lost' end
  end;
end $function$;

CREATE OR REPLACE FUNCTION public._leg_outcome(m matches, mk text, pk text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare h int := m.score_home; a int := m.score_away;
begin
  if mk in ('1x2','dc','btts','ou15','ou25','ou35','dnb','eg','cs') or mk ~ '^g[ha][0-9]+$' or mk ~ '^hc[mp][0-9]+$' then return public._sel_outcome(mk, pk, h, a);
  elsif mk ~ '^ou[0-9]+$' then return public._ou_outcome(mk, pk, h + a);
  elsif mk ~ '^hto[0-9]+$' then return public._ou_outcome(mk, pk, m.ht_home + m.ht_away);
  elsif mk in ('ht1x2','btts1','btts2') then
    if m.ht_home is null or m.ht_away is null or (mk = 'btts2' and (h is null or a is null)) then return 'canceled'; end if;
    return case when public._goal_leg(mk, pk, coalesce(h, 0), coalesce(a, 0), m.ht_home, m.ht_away) then 'won' else 'lost' end;
  elsif mk = 'c1x2' or mk ~ '^co[0-9]+$' then return public._corner_outcome(mk, pk, m.corners_home, m.corners_away);
  elsif mk ~ '^(ch|ca|kh|ka|sh|sa)[0-9]+$' then
    return public._ou_outcome(mk, pk, case left(mk, 2) when 'ch' then m.corners_home when 'ca' then m.corners_away
      when 'kh' then m.cards_home when 'ka' then m.cards_away when 'sh' then m.shots_home else m.shots_away end);
  elsif mk ~ '^k[0-9]+$' then return public._card_outcome(mk, pk, m.cards_home, m.cards_away);
  elsif mk ~ '^s([0-9]+|1x2)$' then return public._stat_outcome(mk, pk, m.shots_home, m.shots_away);
  elsif mk ~ '^t([0-9]+|1x2)$' then return public._stat_outcome(mk, pk, m.sot_home, m.sot_away);
  end if;
  return 'canceled';
end $function$;

-- jogos da The Odds API (migration 073) saem: o basquete passa a vir da 365Scores
delete from public.matches m where m.external_id like 'bkbasketball_%'
  and not exists (select 1 from public.bet_selections s where s.match_id = m.id);

select cron.unschedule('sync-odds-basket');
select cron.schedule('sync-odds-basket', '*/5 * * * *', $$select public._call_sync_odds('basket')$$);
select cron.schedule('sync-odds-basket-live', '10 seconds', $$select public._call_sync_odds('basket_live')$$);
