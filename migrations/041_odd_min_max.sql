-- Esportes: odd mínima por palpite (padrão 1,30) e odd máxima do bilhete (padrão 500). 0 = sem limite.
insert into public.settings (key, value, label) values
  ('bet_odd_min', '1.3', 'Esportes: odd mínima por palpite (0 = sem limite)'),
  ('bet_total_odd_max', '500', 'Esportes: odd máxima do bilhete (0 = sem limite)')
on conflict (key) do update set value = excluded.value;

CREATE OR REPLACE FUNCTION public._bet_quote(p_selections jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_live boolean := false; v_scores jsonb := '{}';
  v_omin numeric := coalesce((public._setting('bet_odd_min'))::text::numeric, 0);
  v_omax numeric := coalesce((public._setting('bet_total_odd_max'))::text::numeric, 0);
begin
  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_m from public.matches where id = (v_sel->>'match_id')::bigint;
    if not found or v_m.status not in ('open','live') then return jsonb_build_object('error', 'Jogo indisponível para apostas'); end if;
    if public._suspension(v_m) is not null then
      return jsonb_build_object('error', format('Apostas suspensas em %s x %s (%s)', v_m.home, v_m.away, public._suspension(v_m)));
    end if;
    v_odd := public._sel_odd(v_m, coalesce(v_sel->>'market', '1x2'), v_sel->>'pick');
    if v_odd is null or v_odd <= 1 then return jsonb_build_object('error', format('Palpite indisponível em %s x %s', v_m.home, v_m.away)); end if;
    if v_omin > 0 and v_odd < v_omin then
      return jsonb_build_object('error', format('Odd mínima por palpite: %s (%s x %s)', replace(to_char(v_omin, 'FM999990.00'), '.', ','), v_m.home, v_m.away));
    end if;
    v_total := v_total * v_odd;
    v_live := v_live or v_m.status = 'live' or v_m.starts_at <= now();
    v_scores := v_scores || jsonb_build_object(v_m.id::text, coalesce(v_m.score_home, 0) + coalesce(v_m.score_away, 0));
  end loop;
  if v_omax > 0 and round(v_total, 2) > v_omax then
    return jsonb_build_object('error', format('Odd máxima do bilhete: %s', replace(to_char(v_omax, 'FM999990.00'), '.', ',')));
  end if;
  return jsonb_build_object('total', round(v_total, 2), 'live', v_live, 'scores', v_scores);
end $function$;

CREATE OR REPLACE FUNCTION public.place_bet(p_selections jsonb, p_stake numeric)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := public._me();
  v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_bet bigint;
  v_n int := jsonb_array_length(p_selections); v_live boolean := false;
  v_live_max numeric := coalesce((public._setting('live_bet_max_stake'))::text::numeric, 0);
  v_omin numeric := coalesce((public._setting('bet_odd_min'))::text::numeric, 0);
  v_omax numeric := coalesce((public._setting('bet_total_odd_max'))::text::numeric, 0);
begin
  if p_stake is null or p_stake < 1 then raise exception 'Aposta mínima: R$ 1,00'; end if;
  if v_n < 1 or v_n > 20 then raise exception 'O bilhete deve ter de 1 a 20 jogos'; end if;
  if (select count(distinct (e->>'match_id')) from jsonb_array_elements(p_selections) e) <> v_n then
    raise exception 'Só um palpite por jogo';
  end if;

  for v_sel in select * from jsonb_array_elements(p_selections) loop
    select * into v_m from public.matches where id = (v_sel->>'match_id')::bigint for share;
    if not found or v_m.status not in ('open','live') then raise exception 'Jogo indisponível para apostas'; end if;
    if public._suspension(v_m) is not null then
      raise exception 'Apostas suspensas em % (%)', v_m.home || ' x ' || v_m.away, public._suspension(v_m);
    end if;
    v_odd := public._sel_odd(v_m, coalesce(v_sel->>'market', '1x2'), v_sel->>'pick');
    if v_odd is null or v_odd <= 1 then raise exception 'Palpite indisponível em %', v_m.home || ' x ' || v_m.away; end if;
    if v_omin > 0 and v_odd < v_omin then
      raise exception 'Odd mínima por palpite: % (%)', replace(to_char(v_omin, 'FM999990.00'), '.', ','), v_m.home || ' x ' || v_m.away;
    end if;
    v_total := v_total * v_odd;
    v_live := v_live or v_m.status = 'live' or v_m.starts_at <= now();
  end loop;
  -- ao vivo só entra pela confirmação com espera (place_bet_request → place_bet_confirm)
  if v_live and coalesce(current_setting('rs.live_ok', true), '') <> '1' then
    raise exception 'Aposta ao vivo: atualize a página e tente de novo';
  end if;
  if v_live and v_live_max > 0 and p_stake > v_live_max then
    raise exception 'Aposta máxima ao vivo: R$ %', v_live_max;
  end if;
  v_total := round(v_total, 2);
  if v_omax > 0 and v_total > v_omax then raise exception 'Odd máxima do bilhete: %', replace(to_char(v_omax, 'FM999990.00'), '.', ','); end if;

  perform public._move(v_user, -p_stake, 'bet', 'Aposta esportiva');
  insert into public.bets (user_id, stake, total_odd, potential)
  values (v_user, p_stake, v_total, round(p_stake * v_total, 2)) returning id into v_bet;

  insert into public.bet_selections (bet_id, match_id, market, pick, odd)
  select v_bet, m.id, coalesce(e->>'market', '1x2'), e->>'pick', public._sel_odd(m, coalesce(e->>'market', '1x2'), e->>'pick')
  from jsonb_array_elements(p_selections) e join public.matches m on m.id = (e->>'match_id')::bigint;

  update public.transactions set description = 'Aposta #' || v_bet
   where id = (select max(id) from public.transactions where user_id = v_user and type = 'bet');
  return v_bet;
end $function$;
