-- Gerenciar odds: ajuste em % por mercado e resultado sobre a odd da fonte (-5 = 5% menor)
-- formato: { "1x2": { "home": { "pct": -5, "on": true }, ... }, "dc": { "1x": {...} }, ... }
insert into public.settings (key, value, label)
values ('odds_adjust', '{}'::jsonb, 'Gerenciar odds: ajuste % por mercado (edite em Apostas e jogos → Gerenciar odds)')
on conflict (key) do nothing;

create or replace function public._odds_factor(c jsonb, mk text, pick text)
returns numeric language sql immutable as $$
  select case when coalesce((c -> mk -> pick ->> 'on')::boolean, false)
              then 1 + coalesce((c -> mk -> pick ->> 'pct')::numeric, 0) / 100 else 1 end
$$;

create or replace function public._odds_scale(x numeric, f numeric)
returns numeric language sql immutable as $$
  select case when x is null or x <= 1 or f = 1 then x else round(greatest(1.01, floor(x * f * 100) / 100), 2) end
$$;

create or replace function public.admin_set_odds_adjust(p_value jsonb)
returns void language plpgsql security definer set search_path = public as $$
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

  -- vale na hora para jogos abertos e ao vivo: tira o ajuste antigo e aplica o novo
  update public.matches m set
    odd_home = public._odds_scale(odd_home, public._odds_factor(p_value, '1x2', 'home') / public._odds_factor(v_old, '1x2', 'home')),
    odd_draw = public._odds_scale(odd_draw, public._odds_factor(p_value, '1x2', 'draw') / public._odds_factor(v_old, '1x2', 'draw')),
    odd_away = public._odds_scale(odd_away, public._odds_factor(p_value, '1x2', 'away') / public._odds_factor(v_old, '1x2', 'away')),
    markets = case when jsonb_typeof(m.markets) = 'object' then coalesce((
      select jsonb_object_agg(s.k, case when jsonb_typeof(s.v) = 'object' then coalesce((
        select jsonb_object_agg(t.p, to_jsonb(public._odds_scale(t.x::numeric, public._odds_factor(p_value, s.k, t.p) / public._odds_factor(v_old, s.k, t.p))))
        from jsonb_each_text(s.v) t(p, x)), '{}'::jsonb) else s.v end)
      from jsonb_each(m.markets) s(k, v)), '{}'::jsonb) else m.markets end
  where m.status in ('open', 'live');

  update public.settings set value = p_value, updated_at = now(), updated_by = auth.uid() where key = 'odds_adjust';
  perform public._audit('odds.ajuste', 'setting', 'odds_adjust', null, jsonb_build_object('value', v_old), jsonb_build_object('value', p_value));
end $$;
revoke execute on function public.admin_set_odds_adjust(jsonb) from public, anon;
grant execute on function public.admin_set_odds_adjust(jsonb) to authenticated;
