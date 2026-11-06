-- Cashout pela odd real (igual à Betano): o teto (odd_max/live_odd_max) vale só pra apostar.
-- O sync-odds guarda em cashout_odds a odd real dos palpites que passaram do teto ("mercado:palpite" -> odd),
-- e o cashout calcula por ela em vez de ficar indisponível no teto.
alter table public.matches add column if not exists cashout_odds jsonb;

create or replace function public._co_odd(m public.matches, p_market text, p_pick text)
returns numeric language sql stable set search_path = public as $$
  select coalesce(nullif(m.cashout_odds ->> (coalesce(p_market, '1x2') || ':' || p_pick), '')::numeric,
                  public._sel_odd(m, p_market, p_pick))
$$;

create or replace function public.cashout_quote(p_bet bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_b public.bets; v_factor numeric := 1; r record; v_live boolean := false; v_val numeric;
  v_min numeric := coalesce((public._setting('cashout_min'))::text::numeric, 0);
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' then return null; end if;
  for r in select s.status, s.match_id, m.status as m_status, m.starts_at, public._co_odd(m, s.market, s.pick) as now_odd,
                  public._suspension(m) as reason
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      if r.reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', r.reason, 'match', r.match_id); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      if r.now_odd is null or r.now_odd <= 1 then
        return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Mercado indisponível', 'match', r.match_id);
      end if;
      v_factor := v_factor / r.now_odd;
    end if;
  end loop;
  v_val := least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential);
  -- abaixo do mínimo (cashout_min): indisponível, mas mostra o valor atual e o mínimo
  if v_min > 0 and v_val < v_min then
    return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Abaixo do mínimo', 'now', v_val, 'min', v_min);
  end if;
  return jsonb_build_object('value', v_val, 'suspended', false, 'live', v_live);
end $$;

insert into public.settings (key, value, label) values ('cashout_min', '1', 'Valor mínimo do cash out (R$)')
on conflict (key) do nothing;
