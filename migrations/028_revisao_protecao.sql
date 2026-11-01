-- Revisão da 027: cashout desligado/limite valem também na confirmação; aposta ao vivo nunca registra odd abaixo do pedido
create or replace function public.cashout_confirm(p_request bigint) returns numeric
language plpgsql security definer set search_path = public as $function$
declare v_user uuid := public._me(); v_r public.cashout_requests; v_q jsonb; v_val numeric; v_why text;
  v_max numeric := coalesce((public._setting('live_cashout_max'))::text::numeric, 0);
begin
  select * into v_r from public.cashout_requests where id = p_request and user_id = v_user for update;
  if not found or v_r.status <> 'waiting' then raise exception 'Pedido de cashout não encontrado'; end if;
  if v_r.created_at > now() - interval '6 seconds' then raise exception 'Aguarde a confirmação do cashout'; end if;
  perform 1 from public.bets where id = v_r.bet_id and user_id = v_user and status = 'pending' for update;
  if not found then v_why := 'Bilhete não disponível para cashout';
  elsif v_r.created_at < now() - interval '60 seconds' then v_why := 'Pedido expirado. Tente de novo.';
  elsif coalesce((public._setting('live_cashout_enabled'))::text::boolean, true) is false then v_why := 'Cashout ao vivo indisponível no momento';
  elsif public._cashout_scores(v_r.bet_id) <> v_r.scores then v_why := 'Cashout recusado: gol no jogo';
  else
    v_q := public.cashout_quote(v_r.bet_id);
    v_val := (v_q->>'value')::numeric;
    if coalesce((v_q->>'suspended')::boolean, false) then v_why := 'Cashout recusado: ' || (v_q->>'reason');
    elsif v_val is null or v_val <= 0 then v_why := 'Cashout indisponível no momento';
    elsif v_val < v_r.expected * 0.97 then v_why := format('Cashout recusado: o valor caiu para R$ %s. Tente de novo.', replace(v_val::text, '.', ','));
    elsif v_max > 0 and least(v_val, v_r.expected) > v_max then v_why := format('Cashout ao vivo acima do limite de R$ %s', v_max);
    end if;
  end if;
  if v_why is not null then
    update public.cashout_requests set status = 'rejected', reason = v_why, done_at = now() where id = p_request;
    return null;
  end if;
  v_val := least(v_val, v_r.expected);
  update public.cashout_requests set status = 'paid', paid = v_val, done_at = now() where id = p_request;
  return public._cashout_pay(v_r.bet_id, v_user, v_val);
end $function$;

create or replace function public.place_bet_confirm(p_request bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_r public.bet_requests; v_q jsonb; v_why text; v_bet bigint;
  v_wait int := greatest(coalesce((public._setting('live_bet_delay'))::text::int, 7), 3);
begin
  select * into v_r from public.bet_requests where id = p_request and user_id = v_user for update;
  if not found or v_r.status <> 'waiting' then raise exception 'Pedido de aposta não encontrado'; end if;
  if v_r.created_at > now() - make_interval(secs => v_wait - 1) then raise exception 'Aguarde a confirmação da aposta'; end if;
  v_q := public._bet_quote(v_r.selections);
  if v_r.created_at < now() - interval '60 seconds' then v_why := 'Pedido expirado. Tente de novo.';
  elsif v_q ? 'error' then v_why := 'Aposta recusada: ' || (v_q->>'error');
  elsif v_q->'scores' <> v_r.scores then v_why := 'Aposta recusada: gol no jogo';
  elsif (v_q->>'total')::numeric < v_r.total_odd then v_why := format('Aposta recusada: a odd caiu para %s. Tente de novo.', v_q->>'total');
  end if;
  if v_why is not null then
    update public.bet_requests set status = 'rejected', reason = v_why, done_at = now() where id = p_request;
    return null;
  end if;
  perform set_config('rs.live_ok', '1', true);
  v_bet := public.place_bet(v_r.selections, v_r.stake);
  perform set_config('rs.live_ok', '', true);
  -- a odd pode ter mudado entre a conferência e o registro: nunca aceitar abaixo do pedido
  if (select total_odd from public.bets where id = v_bet) < v_r.total_odd then
    raise exception 'A odd caiu durante a confirmação. Tente de novo.';
  end if;
  update public.bet_requests set status = 'placed', bet_id = v_bet, done_at = now() where id = p_request;
  return v_bet;
end $$;

