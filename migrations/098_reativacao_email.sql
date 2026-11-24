-- Reativação: também manda e-mail (fila email_outbox, enviada pelo ops-tick via Resend).
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
    select p.id, p.email, p.username from public.profiles p
    where not coalesce(p.is_admin, false) and p.staff_role is null and not coalesce(p.blocked, false)
      and exists (select 1 from public.transactions t where t.user_id = p.id and t.type = 'deposit' and t.status = 'done')
      and not exists (select 1 from public.transactions t where t.user_id = p.id and t.type in ('bet', 'casino_bet')
                        and t.created_at > now() - make_interval(days => v_days))
      -- só quem parou há pouco (até 60 dias): conta abandonada há meses não volta com R$ 5
      and exists (select 1 from public.transactions t where t.user_id = p.id and t.type in ('bet', 'casino_bet')
                    and t.created_at > now() - interval '60 days')
      and not exists (select 1 from public.user_limits l where l.user_id = p.id and l.self_excluded_until > now())
      and not exists (select 1 from public.user_rewards w where w.user_id = p.id and w.source like 'reativacao:%'
                        and w.created_at > now() - interval '30 days')
  loop
    perform public._grant_reward(r.id, 'freebet', v_amt, v_title, 'reativacao:' || current_date);
    insert into public.push_outbox (user_id, title, body)
    values (r.id, v_title, 'Sentimos sua falta! Tem uma freebet esperando por você na Real Sports. Use no bilhete hoje.');
    if r.email like '%@%' then
      insert into public.email_outbox (to_email, subject, body, ref)
      values (r.email, 'Sentimos sua falta! ' || v_title,
        format(E'Oi%s!\n\nFaz %s dias que você não aparece na Real Sports, então deixamos um presente na sua conta: %s.\n\nÉ só entrar, montar seu bilhete e usar a freebet (odd mínima %s, válida por %s dias). O lucro vai para o saldo, sem rollover.\n\nApostar agora: https://realsports.online\n\n+18 | Jogue com responsabilidade.\n',
          coalesce(' ' || nullif(r.username, ''), ''), v_days, v_title,
          coalesce((public._setting('freebet_min_odd'))::text, '1.5'), coalesce((public._setting('reward_days'))::text, '7')),
        'reativacao:' || r.id || ':' || current_date)
      on conflict (ref) do nothing;
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.reactivate_idle() from public, anon, authenticated;
