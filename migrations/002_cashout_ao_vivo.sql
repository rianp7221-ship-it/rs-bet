-- ---------- CASHOUT AO VIVO: suspensão automática e trava manual ----------
alter table public.matches
  add column if not exists synced_at timestamptz,
  add column if not exists locked boolean not null default false,
  add column if not exists suspended_until timestamptz,
  add column if not exists suspend_reason text;

-- gol/ponto ou odd mexendo forte => suspende apostas e cashout por um tempo
create or replace function public._match_guard() returns trigger
language plpgsql as $$
begin
  if new.sport in ('Futebol', 'Hóquei')
     and coalesce(new.score_home, 0) + coalesce(new.score_away, 0) <> coalesce(old.score_home, 0) + coalesce(old.score_away, 0) then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '90 seconds');
    new.suspend_reason := 'Gol no jogo';
  elsif greatest(abs(new.odd_home - old.odd_home) / old.odd_home,
                 abs(new.odd_draw - old.odd_draw) / old.odd_draw,
                 abs(new.odd_away - old.odd_away) / old.odd_away) > 0.15 then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '30 seconds');
    new.suspend_reason := 'Odds em movimento';
  end if;
  return new;
end $$;
drop trigger if exists match_guard on public.matches;
create trigger match_guard before update on public.matches for each row execute function public._match_guard();

-- motivo da suspensão (null = liberado)
create or replace function public._suspension(m public.matches) returns text
language sql stable as $$
  select case
    when m.locked then 'Suspenso pelo operador'
    when m.suspended_until > now() then coalesce(m.suspend_reason, 'Suspenso')
    when m.external_id is not null and (m.status = 'live' or m.starts_at <= now())
         and (m.synced_at is null or m.synced_at < now() - interval '4 minutes') then 'Aguardando atualização do jogo'
  end
$$;

-- cotação do cashout: {value, suspended, reason, live} (null = sem cashout)
create or replace function public.cashout_quote(p_bet bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_b public.bets; v_factor numeric := 1; r record; v_now numeric; v_live boolean := false;
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' then return null; end if;
  for r in select s.status, s.pick, m.status as m_status, m.starts_at, m.odd_home, m.odd_draw, m.odd_away,
                  public._suspension(m) as reason
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      if r.reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', r.reason); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      v_now := case r.pick when 'home' then r.odd_home when 'draw' then r.odd_draw else r.odd_away end;
      if v_now is null then return null; end if;
      v_factor := v_factor / v_now;
    end if;
  end loop;
  return jsonb_build_object('value', least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential),
                            'suspended', false, 'live', v_live);
end $$;

create or replace function public.cashout_value(p_bet bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select (public.cashout_quote(p_bet)->>'value')::numeric
$$;

-- ao vivo: espera 4s e cota de novo antes de pagar (pega gol/odd que mudou nesse meio tempo)
create or replace function public.cashout_bet(p_bet bigint, p_expected numeric) returns numeric
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_q jsonb; v_val numeric;
begin
  perform 1 from public.bets where id = p_bet and user_id = v_user and status = 'pending' for update;
  if not found then raise exception 'Bilhete não disponível para cashout'; end if;
  v_q := public.cashout_quote(p_bet);
  if coalesce((v_q->>'live')::boolean, false) then
    perform pg_sleep(4);
    v_q := public.cashout_quote(p_bet);
  end if;
  if coalesce((v_q->>'suspended')::boolean, false) then raise exception 'Cashout suspenso: %', v_q->>'reason'; end if;
  v_val := (v_q->>'value')::numeric;
  if v_val is null or v_val <= 0 then raise exception 'Cashout indisponível no momento'; end if;
  if abs(v_val - p_expected) > 0.01 then raise exception 'O valor do cashout mudou para R$ %. Tente de novo.', v_val; end if;
  update public.bets set status = 'cashout', cashout_amount = v_val, settled_at = now() where id = p_bet;
  perform public._move(v_user, v_val, 'cashout', 'Cashout do bilhete #' || p_bet);
  return v_val;
end $$;

-- apostas também ficam bloqueadas enquanto o jogo estiver suspenso
create or replace function public.place_bet(p_selections jsonb, p_stake numeric) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := public._me();
  v_sel jsonb; v_m public.matches; v_odd numeric; v_total numeric := 1; v_bet bigint;
  v_n int := jsonb_array_length(p_selections);
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
    v_odd := case v_sel->>'pick' when 'home' then v_m.odd_home when 'draw' then v_m.odd_draw when 'away' then v_m.odd_away end;
    if v_odd is null then raise exception 'Palpite inválido em %', v_m.home || ' x ' || v_m.away; end if;
    v_total := v_total * v_odd;
  end loop;
  v_total := round(v_total, 2);

  perform public._move(v_user, -p_stake, 'bet', 'Aposta esportiva');
  insert into public.bets (user_id, stake, total_odd, potential)
  values (v_user, p_stake, v_total, round(p_stake * v_total, 2)) returning id into v_bet;

  insert into public.bet_selections (bet_id, match_id, pick, odd)
  select v_bet, (e->>'match_id')::bigint, e->>'pick',
         case e->>'pick' when 'home' then m.odd_home when 'draw' then m.odd_draw else m.odd_away end
  from jsonb_array_elements(p_selections) e join public.matches m on m.id = (e->>'match_id')::bigint;

  update public.transactions set description = 'Aposta #' || v_bet
   where id = (select max(id) from public.transactions where user_id = v_user and type = 'bet');
  return v_bet;
end $$;

-- a sincronização automática (cron) roda como service_role e também pode liquidar jogos
create or replace function public._require_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') = 'service_role' then return; end if;
  if not public.is_admin() then raise exception 'Apenas administradores'; end if;
end $$;

revoke execute on function public._suspension(public.matches), public._match_guard() from public, anon, authenticated;
grant execute on function public.cashout_quote(bigint), public.cashout_value(bigint), public.cashout_bet(bigint, numeric),
  public.place_bet(jsonb, numeric) to authenticated;
