-- "Odds em movimento" só para salto entre leituras seguidas: quando o mercado volta depois de ficar fora
-- (odds paradas há mais de 20 s), a diferença acumulada não trava o cashout por mais 30 s
create or replace function public._match_guard()
returns trigger language plpgsql as $$
begin
  if new.sport in ('Futebol', 'Hóquei')
     and coalesce(new.score_home, 0) + coalesce(new.score_away, 0) <> coalesce(old.score_home, 0) + coalesce(old.score_away, 0) then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '90 seconds');
    new.suspend_reason := 'Gol no jogo';
  elsif old.odds_at > now() - interval '20 seconds'
    and greatest(abs(1 / nullif(new.odd_home, 0) - 1 / nullif(old.odd_home, 0)),
                 abs(1 / nullif(new.odd_draw, 0) - 1 / nullif(old.odd_draw, 0)),
                 abs(1 / nullif(new.odd_away, 0) - 1 / nullif(old.odd_away, 0))) >= 0.08 then
    new.suspended_until := greatest(coalesce(new.suspended_until, now()), now() + interval '30 seconds');
    new.suspend_reason := 'Odds em movimento';
  end if;
  return new;
end $$;
