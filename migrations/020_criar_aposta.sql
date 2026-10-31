-- Criar Aposta: 2 a 4 mercados do mesmo jogo (pré-jogo) numa seleção só.
-- bet_selections.market = 'bb', pick = 'mercado:palpite|mercado:palpite' (ex.: '1x2:home|btts:yes|ou35:under').
-- Preço: modelo de Poisson ajustado às odds do jogo (1X2 + Total de Gols 2,5), probabilidade exata da
-- combinação pelo placar, margem `bb_margin` e teto no produto das odds individuais.
alter table public.matches add column if not exists bb_lh numeric, add column if not exists bb_la numeric;

insert into public.settings (key, value, label) values ('bb_margin', '10', 'Criar Aposta: margem (%)')
on conflict (key) do nothing;

alter table public.bet_selections drop constraint if exists bet_selections_market_pick;
alter table public.bet_selections add constraint bet_selections_market_pick check (
  (market = '1x2' and pick in ('home','draw','away')) or
  (market in ('ou15','ou25','ou35') and pick in ('over','under')) or
  (market = 'btts' and pick in ('yes','no')) or
  (market = 'dc' and pick in ('1x','12','x2')) or
  (market = 'dnb' and pick in ('home','away')) or
  (market = 'bb' and pick ~ '^(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+(\|(1x2|ou15|ou25|ou35|btts|dc):[a-z0-9]+){1,3}$'));

-- gols esperados (casa, fora) que reproduzem as odds sem margem
create or replace function public._bb_fit(oh numeric, od numeric, oa numeric, o_over numeric, o_under numeric)
returns numeric[] language plpgsql immutable set search_path = public as $$
declare
  ph float8; pa float8; pu float8 := null; t float8; lo float8; hi float8; s float8; d float8;
  pois_h float8[]; pois_a float8[]; i int; j int; k int; c float8; f float8; lh float8; la float8;
begin
  if oh is null or od is null or oa is null or oh <= 1 or od <= 1 or oa <= 1 then return null; end if;
  c := 1/oh + 1/od + 1/oa; ph := (1/oh)/c; pa := (1/oa)/c;
  if o_over > 1 and o_under > 1 then pu := (1/o_under)/(1/o_over + 1/o_under); end if;
  -- total de gols: P(Poisson(t) <= 2) = pu
  if pu is null then t := 2.6;
  else
    lo := 0.2; hi := 7;
    for k in 1..40 loop
      t := (lo + hi)/2;
      if exp(-t) * (1 + t + t*t/2) > pu then lo := t; else hi := t; end if;
    end loop;
  end if;
  -- divisão casa/fora: P(casa) - P(fora) = ph - pa
  lo := 0.02; hi := 0.98;
  for k in 1..30 loop
    s := (lo + hi)/2; lh := s*t; la := (1-s)*t;
    pois_h := array[exp(-lh)]; pois_a := array[exp(-la)];
    for i in 1..10 loop pois_h := pois_h || pois_h[i]*lh/i; pois_a := pois_a || pois_a[i]*la/i; end loop;
    d := 0;
    for i in 0..10 loop for j in 0..10 loop
      f := pois_h[i+1]*pois_a[j+1];
      if i > j then d := d + f; elsif i < j then d := d - f; end if;
    end loop; end loop;
    if d < ph - pa then lo := s; else hi := s; end if;
  end loop;
  return array[round(lh::numeric, 4), round(la::numeric, 4)];
end $$;

create or replace function public._bb_lambdas() returns trigger
language plpgsql set search_path = public as $$
declare v numeric[];
begin
  if new.status = 'open' then
    v := public._bb_fit(new.odd_home, new.odd_draw, new.odd_away,
                        nullif(new.markets #>> '{ou25,over}', '')::numeric, nullif(new.markets #>> '{ou25,under}', '')::numeric);
    new.bb_lh := v[1]; new.bb_la := v[2];
  end if;
  return new;
end $$;
drop trigger if exists matches_bb on public.matches;
create trigger matches_bb before insert or update of odd_home, odd_draw, odd_away, markets, status on public.matches
  for each row execute function public._bb_lambdas();
update public.matches set status = status where status = 'open';

-- resultado de cada perna pelo placar (sql recursivo evitado: plpgsql)
create or replace function public._sel_outcome(p_market text, p_pick text, h int, a int) returns text
language plpgsql immutable set search_path = public as $$
declare l text; o text; v_all text := 'won';
begin
  if h is null or a is null then return 'canceled'; end if;
  if p_market = 'bb' then
    foreach l in array string_to_array(p_pick, '|') loop
      o := public._sel_outcome(split_part(l, ':', 1), split_part(l, ':', 2), h, a);
      if o = 'lost' then return 'lost'; end if;
      if o <> 'won' then v_all := 'canceled'; end if;
    end loop;
    return v_all;
  end if;
  return case
    when p_market in ('ou15','ou25','ou35') then
      case when (h + a > case p_market when 'ou15' then 1.5 when 'ou25' then 2.5 else 3.5 end) = (p_pick = 'over') then 'won' else 'lost' end
    when p_market = 'btts' then case when (h > 0 and a > 0) = (p_pick = 'yes') then 'won' else 'lost' end
    when p_market = 'dc' then
      case when (p_pick = '1x' and h >= a) or (p_pick = 'x2' and h <= a) or (p_pick = '12' and h <> a) then 'won' else 'lost' end
    when p_market = 'dnb' then
      case when h = a then 'canceled' when (h > a) = (p_pick = 'home') then 'won' else 'lost' end
    else case when (case when h > a then 'home' when h < a then 'away' else 'draw' end) = p_pick then 'won' else 'lost' end
  end;
end $$;

-- odd da combinação; null se o jogo já começou, perna repetida/indisponível ou combinação impossível
create or replace function public._bb_odd(m public.matches, p_pick text) returns numeric
language plpgsql stable set search_path = public as $$
declare
  legs text[] := string_to_array(p_pick, '|'); l text; mk text; pk text; o numeric; prod numeric := 1;
  pois_h float8[]; pois_a float8[]; i int; j int; p float8 := 0; ok boolean; v numeric;
  margin numeric := coalesce((public._setting('bb_margin') #>> '{}')::numeric, 10) / 100;
begin
  if m.status <> 'open' or m.starts_at <= now() or m.bb_lh is null or m.bb_la is null then return null; end if;
  if cardinality(legs) not between 2 and 4 then return null; end if;
  if (select count(distinct split_part(x, ':', 1)) from unnest(legs) x) <> cardinality(legs) then return null; end if;
  foreach l in array legs loop
    mk := split_part(l, ':', 1); pk := split_part(l, ':', 2);
    if mk not in ('1x2','ou15','ou25','ou35','btts','dc') then return null; end if;
    o := public._sel_odd(m, mk, pk);
    if o is null or o <= 1 then return null; end if;
    prod := prod * o;
  end loop;
  pois_h := array[exp(-m.bb_lh::float8)]; pois_a := array[exp(-m.bb_la::float8)];
  for i in 1..10 loop pois_h := pois_h || pois_h[i]*m.bb_lh::float8/i; pois_a := pois_a || pois_a[i]*m.bb_la::float8/i; end loop;
  for i in 0..10 loop for j in 0..10 loop
    ok := true;
    foreach l in array legs loop
      if public._sel_outcome(split_part(l, ':', 1), split_part(l, ':', 2), i, j) <> 'won' then ok := false; exit; end if;
    end loop;
    if ok then p := p + pois_h[i+1]*pois_a[j+1]; end if;
  end loop; end loop;
  if p < 0.002 then return null; end if;
  v := round(least(prod, (1 / p)::numeric * (1 - margin)), 2);
  return case when v >= 1.05 then v end;
end $$;

create or replace function public._sel_odd(m public.matches, p_market text, p_pick text) returns numeric
language sql stable set search_path = public as $$
  select case when coalesce(p_market, '1x2') = '1x2' then
           case p_pick when 'home' then m.odd_home when 'draw' then m.odd_draw when 'away' then m.odd_away end
         when p_market = 'bb' then public._bb_odd(m, p_pick)
         else nullif((m.markets -> p_market ->> p_pick), '')::numeric end
$$;

-- margem usada pelo site para mostrar a odd antes de apostar (o servidor recalcula em place_bet)
create or replace function public.bb_params() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('margin', coalesce((public._setting('bb_margin') #>> '{}')::numeric, 10))
$$;

revoke execute on function public._bb_fit(numeric, numeric, numeric, numeric, numeric), public._bb_odd(public.matches, text),
  public._sel_odd(public.matches, text, text), public._sel_outcome(text, text, int, int) from public, anon, authenticated;
grant execute on function public.bb_params() to anon, authenticated;
