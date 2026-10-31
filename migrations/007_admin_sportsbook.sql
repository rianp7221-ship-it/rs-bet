-- =====================================================
--  007 — Painel admin, fase 4: exposição por jogo, anular mercado, cancelamento em massa e limites de aposta
-- =====================================================
insert into public.settings (key, value, label) values
  ('bet_max_stake', '5000', 'Aposta máxima por bilhete (R$)'),
  ('bet_max_payout', '50000', 'Retorno máximo por bilhete (R$)')
on conflict (key) do nothing;

-- quanto a casa paga em cada resultado de cada jogo em aberto (bilhetes pendentes)
create or replace function public.admin_exposure() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._require_perm('sports.view');
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.worst desc) from (
    select m.id, m.home, m.away, m.league, m.status, m.starts_at, m.locked,
      count(distinct b.id) as bets, coalesce(sum(b.stake), 0) as staked,
      coalesce(sum(b.potential) filter (where s.pick = 'home'), 0) as pay_home,
      coalesce(sum(b.potential) filter (where s.pick = 'draw'), 0) as pay_draw,
      coalesce(sum(b.potential) filter (where s.pick = 'away'), 0) as pay_away,
      greatest(coalesce(sum(b.potential) filter (where s.pick = 'home'), 0), coalesce(sum(b.potential) filter (where s.pick = 'draw'), 0),
               coalesce(sum(b.potential) filter (where s.pick = 'away'), 0)) as worst
    from public.matches m
    join public.bet_selections s on s.match_id = m.id and s.status = 'pending'
    join public.bets b on b.id = s.bet_id and b.status = 'pending'
    where m.status in ('open','live','closed')
    group by m.id) x), '[]');
end $$;

-- fecha os bilhetes depois que seleções mudaram (ganha, perde ou continua)
create or replace function public._resolve_bet(p_bet bigint) returns void
language plpgsql security definer set search_path = public as $$
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
  select round(b.stake * exp(sum(ln(odd))), 2) into v_odd from public.bet_selections where bet_id = p_bet and status <> 'canceled';
  update public.bets set potential = v_odd where id = p_bet;
  if not exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'pending') then
    update public.bets set status = 'won', settled_at = now() where id = p_bet;
    perform public._move(b.user_id, v_odd, 'win', 'Prêmio do bilhete #' || p_bet);
  end if;
end $$;

-- anula o mercado do jogo: seleção vira odd 1; bilhete simples é reembolsado
create or replace function public.admin_void_match(p_match bigint, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare v_m public.matches; r record; v_n int := 0;
begin
  perform public._require_perm('sports.manage');
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Informe o motivo'; end if;
  select * into v_m from public.matches where id = p_match for update;
  if not found or v_m.status = 'settled' then raise exception 'Jogo não encontrado ou já liquidado'; end if;
  update public.matches set status = 'canceled', locked = true where id = p_match;
  update public.bet_selections set status = 'canceled' where match_id = p_match and status = 'pending';
  for r in select distinct s.bet_id from public.bet_selections s join public.bets b on b.id = s.bet_id
           where s.match_id = p_match and b.status = 'pending' loop
    perform public._resolve_bet(r.bet_id); v_n := v_n + 1;
  end loop;
  perform public._audit('jogo.anular', 'match', p_match::text, p_reason, jsonb_build_object('jogo', v_m.home || ' x ' || v_m.away, 'status', v_m.status),
                        jsonb_build_object('status', 'canceled', 'bilhetes_afetados', v_n));
  return v_n;
end $$;

-- cancela bilhetes pendentes e devolve o valor apostado
create or replace function public.admin_cancel_bets(p_bets bigint[], p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare b public.bets; v_n int := 0;
begin
  perform public._require_perm('sports.manage');
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Informe o motivo'; end if;
  if cardinality(p_bets) > 500 then raise exception 'Máximo de 500 bilhetes por vez'; end if;
  for b in select * from public.bets where id = any(p_bets) and status = 'pending' for update loop
    update public.bets set status = 'canceled', settled_at = now() where id = b.id;
    update public.bet_selections set status = 'canceled' where bet_id = b.id and status = 'pending';
    perform public._move(b.user_id, b.stake, 'bet_refund', 'Bilhete #' || b.id || ' cancelado: ' || trim(p_reason));
    v_n := v_n + 1;
  end loop;
  perform public._audit('bilhetes.cancelar', 'bet', array_to_string(p_bets, ','), p_reason, null, jsonb_build_object('cancelados', v_n));
  return v_n;
end $$;

-- limites de aposta (valor máximo e retorno máximo) checados antes de aceitar o bilhete
create or replace function public._bet_limits() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_stake numeric := coalesce((public._setting('bet_max_stake'))::text::numeric, 0);
        v_pay numeric := coalesce((public._setting('bet_max_payout'))::text::numeric, 0);
begin
  if v_stake > 0 and new.stake > v_stake then raise exception 'Aposta máxima: R$ %', v_stake; end if;
  if v_pay > 0 and new.potential > v_pay then raise exception 'Retorno máximo por bilhete: R$ %. Diminua o valor ou as seleções.', v_pay; end if;
  return new;
end $$;
drop trigger if exists bet_limits on public.bets;
create trigger bet_limits before insert on public.bets for each row execute function public._bet_limits();

revoke execute on function public._resolve_bet(bigint), public._bet_limits() from public, anon, authenticated;
grant execute on function public.admin_exposure(), public.admin_void_match(bigint, text), public.admin_cancel_bets(bigint[], text) to authenticated;
