-- =====================================================
--  011 — Margem de odds configurável (aplicada pelo sync-odds)
--  0 = usa a odd média do mercado sem alterar
-- =====================================================
insert into public.settings (key, value, label) values
  ('odds_margin_pre', '0', 'Margem das odds pré-jogo (%)'),
  ('odds_margin_live', '0', 'Margem das odds ao vivo (%)')
on conflict (key) do nothing;
