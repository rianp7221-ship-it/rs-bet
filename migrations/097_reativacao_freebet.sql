-- Reativação: quem já depositou e não aposta (esportes ou cassino) há N dias ganha uma freebet,
-- no máximo 1 a cada 30 dias, com aviso no sino e no celular (push). 0 em reactivate_freebet desliga.
insert into public.settings (key, value, label) values
  ('reactivate_freebet', '5', 'Freebet de reativação em R$ (0 desliga)'),
  ('reactivate_days', '7', 'Dias sem apostar para ganhar a freebet de reativação')
on conflict (key) do nothing;

create or replace function public.reactivate_idle() returns int
language plpgsql security definer set search_path = public as $$
declare
  v_amt numeric := coalesce((public._setting('reactivate_freebet'))::text::numeric, 0);
  v_days int := coalesce((public._setting('reactivate_days'))::text::int, 7);
  v_title text; r record; n int := 0;
begin
  if v_amt <= 0 then return 0; end if;
  v_title := 'Freebet de R$ ' || replace(to_char(v_amt, 'FM999990.00'), '.', ',') || ' pra você voltar';
  for r in
    select p.id from public.profiles p
    where not coalesce(p.is_admin, false) and p.staff_role is null and not coalesce(p.blocked, false)
      and exists (select 1 from public.transactions t where t.user_id = p.id and t.type = 'deposit' and t.status = 'done')
      and not exists (select 1 from public.transactions t where t.user_id = p.id and t.type in ('bet', 'casino_bet')
                        and t.created_at > now() - make_interval(days => v_days))
      -- só quem parou há pouco (até 60 dias): conta abandonada há meses não volta com R$ 5
      and exists (select 1 from public.transactions t where t.user_id = p.id and t.type in ('bet', 'casino_bet')
                    and t.created_at > now() - interval '60 days')
      and not exists (select 1 from public.user_rewards w where w.user_id = p.id and w.source like 'reativacao:%'
                        and w.created_at > now() - interval '30 days')
  loop
    perform public._grant_reward(r.id, 'freebet', v_amt, v_title, 'reativacao:' || current_date);
    insert into public.push_outbox (user_id, title, body)
    values (r.id, v_title, 'Sentimos sua falta! Tem uma freebet esperando por você na Real Sports. Use no bilhete hoje.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reactivate_idle() from public, anon, authenticated;

-- todo dia às 18h (Brasília), antes dos jogos da noite
select cron.schedule('reactivate-idle', '0 21 * * *', $$select public.reactivate_idle()$$);
