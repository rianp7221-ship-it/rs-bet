-- =====================================================
--  029 — Leão da Sorte: slot 3x3, 5 linhas, coringa e "Rugido do Leão"
--  Tudo sorteado no servidor. RTP do Admin → Cassino (jogo > provedor > global).
-- =====================================================
alter table public.casino_games drop constraint if exists casino_games_game_check;
alter table public.casino_games add constraint casino_games_game_check check (game in ('mines','dice','leao'));
alter table public.casino_games add column if not exists detail jsonb;

insert into public.casino_catalog (id, provider, name, category, sort, min_stake, max_stake) values
  ('leao', 'realsports', 'Leão da Sorte', 'slots', 0, 0.5, 200)
on conflict (id) do nothing;

create or replace function public._rnd() returns numeric
language sql volatile as $$
  select ('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint / 4294967296.0;
$$;

create or replace function public._leao_pick(p_syms text[], p_w int[]) returns text
language plpgsql volatile as $$
declare r numeric := public._rnd() * (select sum(x) from unnest(p_w) x);
begin
  for i in 1..cardinality(p_syms) loop
    r := r - p_w[i];
    if r < 0 then return p_syms[i]; end if;
  end loop;
  return p_syms[cardinality(p_syms)];
end $$;

-- prêmio da grade (multiplicador sobre a aposta total; cada linha vale 1/5 da aposta)
create or replace function public._leao_pay(g text[]) returns jsonb
language plpgsql immutable as $$
declare
  ln int[] := array[[1,2,3],[4,5,6],[7,8,9],[1,5,9],[3,5,7]];
  pay jsonb := '{"W":250,"I":100,"L":25,"B":10,"E":8,"F":5,"O":3}';
  a text; b text; c text; s text; m numeric := 0; won int[] := '{}';
begin
  for i in 1..5 loop
    a := g[ln[i][1]]; b := g[ln[i][2]]; c := g[ln[i][3]];
    s := coalesce(nullif(a, 'W'), nullif(b, 'W'), nullif(c, 'W'), 'W');
    if a in (s, 'W') and b in (s, 'W') and c in (s, 'W') then
      m := m + (pay->>s)::numeric / 5; won := won || (i - 1);
    end if;
  end loop;
  return jsonb_build_object('m', m, 'lines', to_jsonb(won));
end $$;

create or replace function public._leao_hit(g text[], s text) returns boolean
language sql immutable as $$
  select exists (select 1 from (values (1,2,3),(4,5,6),(7,8,9),(1,5,9),(3,5,7)) l(a,b,c)
    where g[a] in (s,'W') and g[b] in (s,'W') and g[c] in (s,'W'));
$$;

-- R0 = RTP natural da tabela (base exata + rodada bônus simulada). Para chegar ao RTP configurado,
-- só (rtp / R0) dos giros usam o sorteio natural; os demais recebem uma grade sem prêmio.
create or replace function public._leao_outcome(p_rtp numeric) returns jsonb
language plpgsql volatile as $$
declare
  sy text[] := '{W,I,L,B,E,F,O}'; wt int[] := '{4,3,5,7,9,11,13}';
  r0 numeric := 106.1; feat numeric := 0.04;
  g text[]; frames jsonb; s text; others text[]; r jsonb; v_full boolean; n int := 0;
begin
  if public._rnd() >= p_rtp / r0 then
    loop
      n := n + 1;
      g := array(select public._leao_pick(sy, wt) from generate_series(1, 9));
      exit when (public._leao_pay(g)->>'m')::numeric = 0 or n >= 50;
    end loop;
    if (public._leao_pay(g)->>'m')::numeric > 0 then g := '{O,F,E,B,L,I,F,O,B}'; end if;
    return jsonb_build_object('frames', jsonb_build_array(to_jsonb(g)), 'm', 0, 'lines', '[]'::jsonb, 'feature', false, 'full', false);
  end if;

  if public._rnd() < feat then
    s := public._leao_pick(sy[2:7], wt[2:7]);
    others := array(select x from unnest(sy) x where x not in (s, 'W'));
    g := array(select case when public._rnd() < 0.3 then s else public._leao_pick(sy, wt) end from generate_series(1, 9));
    g := array(select case when x in (s, 'W') then x else others[1 + floor(public._rnd() * cardinality(others))::int] end
               from unnest(g) with ordinality t(x, k) order by k);
    frames := jsonb_build_array(to_jsonb(g));
    n := 0;
    while not public._leao_hit(g, s) loop
      n := n + 1;
      if n > 80 then g[4] := s; g[5] := s; g[6] := s; frames := frames || jsonb_build_array(to_jsonb(g)); exit; end if;
      g := array(select case when x in (s, 'W') then x when public._rnd() < 0.25 then s
                             else others[1 + floor(public._rnd() * cardinality(others))::int] end
                 from unnest(g) with ordinality t(x, k) order by k);
      frames := frames || jsonb_build_array(to_jsonb(g));
    end loop;
    r := public._leao_pay(g);
    v_full := (select bool_and(x in (s, 'W')) from unnest(g) x);
    return jsonb_build_object('frames', frames, 'm', (r->>'m')::numeric * case when v_full then 10 else 1 end,
      'lines', r->'lines', 'feature', true, 'full', v_full, 'symbol', s);
  end if;

  g := array(select public._leao_pick(sy, wt) from generate_series(1, 9));
  r := public._leao_pay(g);
  return jsonb_build_object('frames', jsonb_build_array(to_jsonb(g)), 'm', (r->>'m')::numeric, 'lines', r->'lines', 'feature', false, 'full', false);
end $$;

create or replace function public.leao_spin(p_stake numeric) returns json
language plpgsql security definer set search_path = public as $$
declare v_user uuid := public._me(); v_cfg jsonb := public._casino_cfg('leao'); o jsonb; v_pay numeric; v_id bigint; v_bal numeric;
begin
  perform public._casino_stake(v_cfg, p_stake);
  perform public._move(v_user, -p_stake, 'casino_bet', 'Leão da Sorte');
  o := public._leao_outcome((v_cfg->>'rtp')::numeric);
  v_pay := round(p_stake * (o->>'m')::numeric, 2);
  if v_pay > 0 then perform public._move(v_user, v_pay, 'casino_win', 'Leão da Sorte'); end if;
  insert into public.casino_games (user_id, game, stake, multiplier, payout, status, rtp, detail)
  values (v_user, 'leao', p_stake, (o->>'m')::numeric, v_pay, case when v_pay > 0 then 'won' else 'lost' end, (v_cfg->>'rtp')::numeric, o)
  returning id into v_id;
  select balance into v_bal from public.profiles where id = v_user;
  return (o || jsonb_build_object('id', v_id, 'payout', v_pay, 'balance', v_bal))::json;
end $$;

revoke execute on function public._rnd(), public._leao_pick(text[], int[]), public._leao_pay(text[]),
  public._leao_hit(text[], text), public._leao_outcome(numeric) from public, anon, authenticated;
revoke execute on function public.leao_spin(numeric) from public, anon;
grant execute on function public.leao_spin(numeric) to authenticated;
