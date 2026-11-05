-- 055 — Teto de odd por palpite em todos os mercados (odd_max, padrão 15; 0 = sem teto).
-- sync-odds/live-events já gravam as odds com o teto; _sel_odd garante no servidor. Criar Aposta (bb) fica de fora.
insert into public.settings (key, value, label) values
  ('odd_max', '15', 'Esportes: odd máxima por palpite, todos os mercados (0 = sem limite)')
on conflict (key) do update set value = excluded.value, label = excluded.label;

create or replace function public._sel_odd(m public.matches, p_market text, p_pick text)
returns numeric language sql stable set search_path = public as $$
  select case when p_market = 'bb' then public._bb_odd(m, p_pick)
         else (select case when c > 1 then least(o, c) else o end
                 from (select case when coalesce(p_market, '1x2') = '1x2' then
                                case p_pick when 'home' then m.odd_home when 'draw' then m.odd_draw when 'away' then m.odd_away end
                              else nullif((m.markets -> p_market ->> p_pick), '')::numeric end o,
                              coalesce((public._setting('odd_max'))::text::numeric, 0) c) t)
         end
$$;

-- aplica o teto nas odds já gravadas dos jogos abertos/ao vivo
with c as (select coalesce((public._setting('odd_max'))::text::numeric, 0) v)
update public.matches m set
  odd_home = least(odd_home, c.v), odd_draw = least(odd_draw, c.v), odd_away = least(odd_away, c.v),
  markets = case when jsonb_typeof(m.markets) = 'object' then (
    select jsonb_object_agg(k, case when jsonb_typeof(v) = 'object' then (
      select coalesce(jsonb_object_agg(p, case when jsonb_typeof(x) = 'number' and x::text::numeric > c.v then to_jsonb(c.v) else x end), '{}')
      from jsonb_each(v) e2(p, x)) else v end)
    from jsonb_each(m.markets) e(k, v)) else m.markets end
from c
where c.v > 1 and m.status in ('open', 'live');
