-- 057 — Cashout ao vivo disponível quando o jogo está normal.
-- Odds em movimento: trava só quando a probabilidade (1/odd) de um resultado muda 8 pontos ou mais numa leitura
-- (antes 15% da odd: a zebra subindo 8 → 9,5 no fim do jogo travava o cashout a cada atualização).
CREATE OR REPLACE FUNCTION public._match_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.sport in ('Futebol', 'Hóquei')
     and coalesce(new.score_home, 0) + coalesce(new.score_away, 0) <> coalesce(old.score_home, 0) + coalesce(old.score_away, 0) then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '90 seconds');
    new.suspend_reason := 'Gol no jogo';
  elsif greatest(abs(1 / nullif(new.odd_home, 0) - 1 / nullif(old.odd_home, 0)),
                 abs(1 / nullif(new.odd_draw, 0) - 1 / nullif(old.odd_draw, 0)),
                 abs(1 / nullif(new.odd_away, 0) - 1 / nullif(old.odd_away, 0))) >= 0.08 then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '30 seconds');
    new.suspend_reason := 'Odds em movimento';
  end if;
  return new;
end $function$;

-- sync-odds: salto de odd medido em pontos de probabilidade
update public.settings set value = '10', updated_at = now(),
  label = 'Trava ao vivo quando a probabilidade de um resultado (1/odd) muda mais que (pontos %) entre duas leituras (0 = desligado)'
 where key = 'odds_jump_pct';
