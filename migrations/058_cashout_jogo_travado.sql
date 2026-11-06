-- 058 — cashout_quote informa qual jogo trava o cashout (`match`), para a barra laranja no bilhete.
CREATE OR REPLACE FUNCTION public.cashout_quote(p_bet bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_b public.bets; v_factor numeric := 1; r record; v_live boolean := false;
  v_cap numeric := coalesce((public._setting('live_odd_max'))::text::numeric, 0);
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' then return null; end if;
  for r in select s.status, s.match_id, m.status as m_status, m.starts_at, public._sel_odd(m, s.market, s.pick) as now_odd,
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
      if v_cap > 1 and r.now_odd >= v_cap and (r.m_status = 'live' or r.starts_at <= now()) then
        return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Cash out indisponível: odd acima do limite', 'match', r.match_id);
      end if;
      v_factor := v_factor / r.now_odd;
    end if;
  end loop;
  return jsonb_build_object('value', least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential),
                            'suspended', false, 'live', v_live);
end $function$;
