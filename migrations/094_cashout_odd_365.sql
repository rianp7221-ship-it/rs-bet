-- Cashout ao vivo quando a API-Football fica sem odd do jogo (casas tiram o 1X2 do ar, ex.: jogo decidido):
-- usa a odd 1X2 da Bet365 pela 365Scores (gravada pelo goal-guard a cada 5 s), com piso de 1.01.
-- Só cobre travas da fonte; gol, VAR, pênalti, expulsão, operador e placar atrasado continuam fechando o cashout.
alter table public.matches
  add column if not exists odds365 jsonb,
  add column if not exists odds365_at timestamptz;

create or replace function public.cashout_quote(p_bet bigint)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_b public.bets; v_factor numeric := 1; r record; v_live boolean := false; v_val numeric; v_reason text; v_odd numeric;
  v_min numeric := coalesce((public._setting('cashout_min'))::text::numeric, 0);
begin
  select * into v_b from public.bets where id = p_bet and user_id = auth.uid();
  if not found or v_b.status <> 'pending' or v_b.freebet_id is not null then return null; end if;
  if exists (select 1 from public.bet_selections where bet_id = p_bet and boosted) then
    return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Odd turbinada: sem cash out', 'boost', true);
  end if;
  for r in select s.status, s.match_id, s.market, s.pick, m.status as m_status, m.starts_at, public._co_odd(m, s.market, s.pick) as now_odd,
                  public._suspension(m) as reason,
                  case when m.status = 'live' and m.odds365_at > now() - interval '20 seconds' then (m.odds365 ->> s.pick)::numeric end as odd365
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      v_reason := r.reason; v_odd := r.now_odd;
      if coalesce(r.market, '1x2') = '1x2' and r.odd365 >= 1
         and (v_reason is null and (v_odd is null or v_odd <= 1)
              or v_reason in ('Mercado suspenso nas casas', 'Mercado travado na fonte', 'Odds desatualizadas na fonte', 'Sem odds ao vivo')) then
        v_reason := null; v_odd := greatest(r.odd365, 1.01);
      end if;
      if v_reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', v_reason, 'match', r.match_id); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      if v_odd is null or v_odd <= 1 then
        return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Mercado indisponível', 'match', r.match_id);
      end if;
      v_factor := v_factor / v_odd;
    end if;
  end loop;
  v_val := least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential);
  if v_min > 0 and v_val < v_min then
    return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Abaixo do mínimo', 'now', v_val, 'min', v_min);
  end if;
  return jsonb_build_object('value', v_val, 'suspended', false, 'live', v_live);
end $function$;
