-- Odd máxima do bilhete (bet_total_odd_max) vira teto: a odd total trava em 500 em vez de recusar a aposta.
-- Bilhete travado = odd cheia das seleções acima da odd gravada; liquidação e correção pelo Admin respeitam o teto.
create or replace function public.bet_limits() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('odd_min', coalesce((public._setting('bet_odd_min'))::text::numeric, 0),
                            'total_odd_max', coalesce((public._setting('bet_total_odd_max'))::text::numeric, 0));
$$;
grant execute on function public.bet_limits() to anon, authenticated;

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
  if v_omax > 0 then v_total := least(v_total, v_omax); end if;
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
  if v_omax > 0 then v_total := least(v_total, v_omax); end if;

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

CREATE OR REPLACE FUNCTION public._resolve_bet(p_bet bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare b public.bets; v_odd numeric;
begin
  select * into b from public.bets where id = p_bet and status = 'pending' for update;
  if not found then return; end if;
  if exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'lost') then
    update public.bets set status = 'lost', settled_at = now() where id = p_bet; return;
  end if;
  if not exists (select 1 from public.bet_selections where bet_id = p_bet and status <> 'canceled') then
    update public.bets set status = 'canceled', potential = b.stake, settled_at = now() where id = p_bet;
    perform public._move(b.user_id, b.stake, 'bet_refund', 'Bilhete #' || p_bet || ' anulado (reembolso)'); return;
  end if;
  select exp(sum(ln(odd))) into v_odd from public.bet_selections where bet_id = p_bet and status <> 'canceled';
  if (select exp(sum(ln(odd))) from public.bet_selections where bet_id = p_bet) > b.total_odd + 0.01 then v_odd := least(v_odd, b.total_odd); end if;
  v_odd := round(b.stake * v_odd, 2);
  update public.bets set potential = v_odd where id = p_bet;
  if not exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'pending') then
    update public.bets set status = 'won', settled_at = now() where id = p_bet;
    perform public._move(b.user_id, v_odd, 'win', 'Prêmio do bilhete #' || p_bet);
  end if;
end $function$;

CREATE OR REPLACE FUNCTION public.admin_bet_edit(p_bet bigint, p_changes jsonb, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  b public.bets; c jsonb; v_before jsonb; v_odd numeric; v_pot numeric; v_status text;
  v_old numeric; v_new numeric; v_capped boolean; v_diff numeric; v_bal numeric;
begin
  perform public._require_perm('sports.manage');
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Informe o motivo'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then raise exception 'Nenhuma alteração'; end if;
  select * into b from public.bets where id = p_bet for update;
  if not found then raise exception 'Bilhete não encontrado'; end if;
  if b.status = 'cashout' then raise exception 'Bilhete com cash out já pago não pode ser editado'; end if;

  -- quanto o jogador já recebeu por este bilhete
  v_capped := (select exp(sum(ln(odd))) from public.bet_selections where bet_id = p_bet) > b.total_odd + 0.01;
  v_old := case b.status when 'won' then b.potential when 'canceled' then b.stake else 0 end;
  select jsonb_build_object('status', b.status, 'odd', b.total_odd, 'retorno', b.potential,
           'selecoes', jsonb_agg(jsonb_build_object('id', id, 'status', status) order by id))
    into v_before from public.bet_selections where bet_id = p_bet;

  for c in select * from jsonb_array_elements(p_changes) loop
    if coalesce(c->>'status', '') not in ('pending', 'won', 'lost', 'canceled') then raise exception 'Status inválido'; end if;
    update public.bet_selections set status = c->>'status' where id = (c->>'id')::bigint and bet_id = p_bet;
    if not found then raise exception 'Seleção % não pertence ao bilhete', c->>'id'; end if;
  end loop;

  select exp(sum(ln(odd))) into v_odd from public.bet_selections where bet_id = p_bet and status <> 'canceled';
  if v_capped then v_odd := least(v_odd, b.total_odd); end if;
  if v_odd is null then
    v_status := 'canceled'; v_odd := 1; v_pot := b.stake; v_new := b.stake;
  else
    v_pot := round(b.stake * v_odd, 2);
    if exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'lost') then v_status := 'lost'; v_new := 0;
    elsif exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'pending') then v_status := 'pending'; v_new := 0;
    else v_status := 'won'; v_new := v_pot;
    end if;
  end if;

  update public.bets set status = v_status, total_odd = round(v_odd, 2), potential = v_pot,
         settled_at = case when v_status = 'pending' then null else coalesce(settled_at, now()) end
   where id = p_bet;

  v_diff := v_new - v_old;
  if v_diff < 0 then
    select balance into v_bal from public.profiles where id = b.user_id;
    if v_bal + v_diff < 0 then
      raise exception 'Saldo do jogador (R$ %) não cobre o estorno de R$ %', v_bal, -v_diff;
    end if;
  end if;
  if v_diff <> 0 then
    perform public._move(b.user_id, v_diff, 'adjust', format('Correção do bilhete #%s: %s', p_bet, trim(p_reason)));
  end if;

  insert into public.notifications (user_id, title, body, created_by)
  values (b.user_id, 'Bilhete #' || p_bet || ' corrigido',
          format('Seu bilhete foi revisado: %s, odd %s, retorno R$ %s. Motivo: %s',
                 case v_status when 'won' then 'ganhou' when 'lost' then 'perdeu' when 'canceled' then 'devolvido' else 'em aberto' end,
                 round(v_odd, 2), v_pot, trim(p_reason)), auth.uid());

  perform public._audit('bilhete.editar', 'bet', p_bet::text, p_reason, v_before,
    jsonb_build_object('status', v_status, 'odd', round(v_odd, 2), 'retorno', v_pot, 'ajuste_saldo', v_diff, 'alteracoes', p_changes));
  return jsonb_build_object('status', v_status, 'odd', round(v_odd, 2), 'retorno', v_pot, 'ajuste', v_diff);
end $function$;
