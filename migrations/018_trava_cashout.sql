-- Trava do cashout ao vivo: o pedido fica 7 s em espera e o jogo é conferido de novo antes de pagar.
-- Se nesse meio tempo vier gol, trava (VAR, pênalti, expulsão, mercado suspenso) ou queda grande no valor, o pedido é recusado.
create table if not exists public.cashout_requests (
  id bigint generated always as identity primary key,
  bet_id bigint not null references public.bets(id) on delete cascade,
  user_id uuid not null,
  expected numeric(12,2) not null,
  scores jsonb not null,
  status text not null default 'waiting' check (status in ('waiting','paid','rejected')),
  reason text,
  paid numeric(12,2),
  created_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists cashout_requests_bet_idx on public.cashout_requests (bet_id, created_at desc);
alter table public.cashout_requests enable row level security;
revoke all on public.cashout_requests from anon, authenticated;

create or replace function public._cashout_scores(p_bet bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(m.id::text, coalesce(m.score_home, 0) + coalesce(m.score_away, 0)), '{}'::jsonb)
  from public.bet_selections s join public.matches m on m.id = s.match_id
  where s.bet_id = p_bet and s.status = 'pending'
$$;

create or replace function public._cashout_pay(p_bet bigint, p_user uuid, p_val numeric) returns numeric
language plpgsql security definer set search_path = public as $$
begin
  update public.bets set status = 'cashout', cashout_amount = p_val, settled_at = now() where id = p_bet;
  perform public._move(p_user, p_val, 'cashout', 'Cashout do bilhete #' || p_bet);
  return p_val;
end $$;

-- 1º passo: pré-jogo paga na hora; ao vivo registra o pedido e devolve quantos segundos esperar
create or replace function public.cashout_request(p_bet bigint, p_expected numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_q jsonb; v_val numeric; v_id bigint;
begin
  perform 1 from public.bets where id = p_bet and user_id = v_user and status = 'pending' for update;
  if not found then raise exception 'Bilhete não disponível para cashout'; end if;
  v_q := public.cashout_quote(p_bet);
  if coalesce((v_q->>'suspended')::boolean, false) then raise exception 'Cashout suspenso: %', v_q->>'reason'; end if;
  v_val := (v_q->>'value')::numeric;
  if v_val is null or v_val <= 0 then raise exception 'Cashout indisponível no momento'; end if;
  if abs(v_val - p_expected) > 0.01 then raise exception 'O valor do cashout mudou para R$ %. Tente de novo.', v_val; end if;
  if not coalesce((v_q->>'live')::boolean, false) then
    return jsonb_build_object('paid', public._cashout_pay(p_bet, v_user, v_val));
  end if;
  update public.cashout_requests set status = 'rejected', reason = 'Substituído por novo pedido', done_at = now()
   where bet_id = p_bet and status = 'waiting';
  insert into public.cashout_requests (bet_id, user_id, expected, scores)
  values (p_bet, v_user, v_val, public._cashout_scores(p_bet)) returning id into v_id;
  return jsonb_build_object('request', v_id, 'wait', 7);
end $$;

-- 2º passo: depois da espera, confere o jogo de novo e paga ou recusa
create or replace function public.cashout_confirm(p_request bigint) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_r public.cashout_requests; v_q jsonb; v_val numeric; v_why text;
begin
  select * into v_r from public.cashout_requests where id = p_request and user_id = v_user for update;
  if not found or v_r.status <> 'waiting' then raise exception 'Pedido de cashout não encontrado'; end if;
  if v_r.created_at > now() - interval '6 seconds' then raise exception 'Aguarde a confirmação do cashout'; end if;
  perform 1 from public.bets where id = v_r.bet_id and user_id = v_user and status = 'pending' for update;
  if not found then v_why := 'Bilhete não disponível para cashout';
  elsif v_r.created_at < now() - interval '60 seconds' then v_why := 'Pedido expirado. Tente de novo.';
  elsif public._cashout_scores(v_r.bet_id) <> v_r.scores then v_why := 'Cashout recusado: gol no jogo';
  else
    v_q := public.cashout_quote(v_r.bet_id);
    v_val := (v_q->>'value')::numeric;
    if coalesce((v_q->>'suspended')::boolean, false) then v_why := 'Cashout recusado: ' || (v_q->>'reason');
    elsif v_val is null or v_val <= 0 then v_why := 'Cashout indisponível no momento';
    elsif v_val < v_r.expected * 0.97 then v_why := format('Cashout recusado: o valor caiu para R$ %s. Tente de novo.', replace(v_val::text, '.', ','));
    end if;
  end if;
  if v_why is not null then
    update public.cashout_requests set status = 'rejected', reason = v_why, done_at = now() where id = p_request;
    return null;
  end if;
  v_val := least(v_val, v_r.expected);
  update public.cashout_requests set status = 'paid', paid = v_val, done_at = now() where id = p_request;
  return public._cashout_pay(v_r.bet_id, v_user, v_val);
end $$;

-- motivo da recusa (o confirm devolve null para gravar a recusa sem desfazer a transação)
create or replace function public.cashout_reason(p_request bigint) returns text
language sql stable security definer set search_path = public as $$
  select reason from public.cashout_requests where id = p_request and user_id = auth.uid()
$$;

-- caminho antigo: pré-jogo continua; ao vivo exige a trava
create or replace function public.cashout_bet(p_bet bigint, p_expected numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_res jsonb;
begin
  v_res := public.cashout_request(p_bet, p_expected);
  if v_res ? 'paid' then return (v_res->>'paid')::numeric; end if;
  raise exception 'Atualize a página para fazer o cashout ao vivo.';
end $$;

revoke execute on function public._cashout_scores(bigint), public._cashout_pay(bigint, uuid, numeric) from public, anon, authenticated;
revoke execute on function public.cashout_request(bigint, numeric), public.cashout_confirm(bigint), public.cashout_reason(bigint) from public, anon;
grant execute on function public.cashout_request(bigint, numeric), public.cashout_confirm(bigint), public.cashout_reason(bigint),
  public.cashout_bet(bigint, numeric) to authenticated;
