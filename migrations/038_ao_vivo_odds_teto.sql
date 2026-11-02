-- Ao vivo: odds da fonte sem o ajuste do "Gerenciar odds" (que agora vale só no pré-jogo) e teto de odd (padrão 10).
-- Com o teto, a odd real pode estar acima do valor mostrado: cash out de seleção ao vivo no teto fica bloqueado.
insert into public.settings (key, value, label) values
  ('live_odd_max', '10', 'Ao vivo: odd máxima (0 = sem limite)')
on conflict (key) do nothing;

CREATE OR REPLACE FUNCTION public.admin_set_odds_adjust(p_value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_old jsonb; v_mk text; v_e jsonb; v_p text;
begin
  perform public._require_perm('sports.manage');
  if jsonb_typeof(p_value) <> 'object' then raise exception 'Valor no formato errado'; end if;
  for v_mk, v_e in select * from jsonb_each(p_value) loop
    if v_mk not in ('1x2', 'dc', 'dnb', 'btts', 'ou15', 'ou25', 'ou35') or jsonb_typeof(v_e) <> 'object' then
      raise exception 'Mercado inválido: %', v_mk;
    end if;
    for v_p in select jsonb_object_keys(v_e) loop
      if abs(coalesce((v_e -> v_p ->> 'pct')::numeric, 0)) > 50 then raise exception 'O ajuste precisa ficar entre -50%% e 50%%'; end if;
    end loop;
  end loop;
  select value into v_old from public.settings where key = 'odds_adjust' for update;
  if not found then raise exception 'Configuração inexistente'; end if;

  -- vale na hora para jogos de pré-jogo: tira o ajuste antigo e aplica o novo (ao vivo usa as odds da fonte)
  update public.matches m set
    odd_home = public._odds_scale(odd_home, public._odds_factor(p_value, '1x2', 'home') / public._odds_factor(v_old, '1x2', 'home')),
    odd_draw = public._odds_scale(odd_draw, public._odds_factor(p_value, '1x2', 'draw') / public._odds_factor(v_old, '1x2', 'draw')),
    odd_away = public._odds_scale(odd_away, public._odds_factor(p_value, '1x2', 'away') / public._odds_factor(v_old, '1x2', 'away')),
    markets = case when jsonb_typeof(m.markets) = 'object' then coalesce((
      select jsonb_object_agg(s.k, case when jsonb_typeof(s.v) = 'object' then coalesce((
        select jsonb_object_agg(t.p, to_jsonb(public._odds_scale(t.x::numeric, public._odds_factor(p_value, s.k, t.p) / public._odds_factor(v_old, s.k, t.p))))
        from jsonb_each_text(s.v) t(p, x)), '{}'::jsonb) else s.v end)
      from jsonb_each(m.markets) s(k, v)), '{}'::jsonb) else m.markets end
  where m.status = 'open' and m.starts_at > now();

  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = 'odds_adjust';
  perform public._audit('odds.ajuste', 'setting', 'odds_adjust', null, jsonb_build_object('value', v_old), jsonb_build_object('value', p_value));
end $function$;

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
  for r in select s.status, m.status as m_status, m.starts_at, public._sel_odd(m, s.market, s.pick) as now_odd,
                  public._suspension(m) as reason
           from public.bet_selections s join public.matches m on m.id = s.match_id where s.bet_id = p_bet loop
    if r.status = 'lost' then return null; end if;
    if r.status = 'pending' then
      if r.m_status not in ('open','live') then return null; end if;
      if r.reason is not null then return jsonb_build_object('value', null, 'suspended', true, 'reason', r.reason); end if;
      v_live := v_live or r.m_status = 'live' or r.starts_at <= now();
      if r.now_odd is null or r.now_odd <= 1 then return null; end if;
      if v_cap > 1 and r.now_odd >= v_cap and (r.m_status = 'live' or r.starts_at <= now()) then
        return jsonb_build_object('value', null, 'suspended', true, 'reason', 'Cash out indisponível: odd acima do limite');
      end if;
      v_factor := v_factor / r.now_odd;
    end if;
  end loop;
  return jsonb_build_object('value', least(round(v_b.potential * v_factor * case when v_live then 0.92 else 0.95 end, 2), v_b.potential),
                            'suspended', false, 'live', v_live);
end $function$;
