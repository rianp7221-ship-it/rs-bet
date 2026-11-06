-- fase do jogo vinda da fonte (1H, HT, 2H, ET, BT, P): no intervalo o relógio mostra "Intervalo" em vez de seguir contando
alter table public.matches add column if not exists period text;
