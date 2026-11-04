-- =====================================================
--  050 — Mercados extras do pré-jogo pela Bet365 (média das casas só quando a Bet365 não tem)
--  odds_extra_pct: % aplicado nessas odds quando o mercado não tem ajuste próprio no Gerenciar odds (-4 = 4% abaixo).
-- =====================================================
insert into public.settings (key, value, label) values
  ('odds_extra_pct', '-4', 'Mercados extras pré-jogo: % sobre a odd da Bet365 (-4 = 4% abaixo)')
on conflict (key) do nothing;
