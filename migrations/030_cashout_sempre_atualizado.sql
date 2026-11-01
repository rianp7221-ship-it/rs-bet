-- Cashout sempre atualizado: dados ao vivo velhos travam mais cedo e cotação de todos os bilhetes numa chamada
insert into public.settings (key, value, label) values
  ('live_stale_secs', '30', 'Ao vivo: trava apostas e cashout se o jogo ficar sem atualização por (segundos, mínimo 15)')
on conflict (key) do nothing;

create or replace function public._suspension(m public.matches) returns text
language sql stable as $$
  select case
    when m.locked then 'Suspenso pelo operador'
    when m.suspended_until > now() then coalesce(m.suspend_reason, 'Suspenso')
    when m.external_id is not null and (m.status = 'live' or m.starts_at <= now())
         and (m.synced_at is null or m.synced_at < now()
              - make_interval(secs => greatest(coalesce((public._setting('live_stale_secs'))::text::int, 30), 15)))
      then 'Aguardando atualização do jogo'
  end
$$;
revoke execute on function public._suspension(public.matches) from public, anon, authenticated;

create or replace function public.cashout_quotes(p_bets bigint[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb := '{}'; v_id bigint;
begin
  if auth.uid() is null then return v; end if;
  foreach v_id in array coalesce(p_bets[1:50], '{}') loop
    v := v || jsonb_build_object(v_id::text, public.cashout_quote(v_id));
  end loop;
  return v || jsonb_build_object('at', extract(epoch from now()));
end $$;
revoke execute on function public.cashout_quotes(bigint[]) from public, anon;
grant execute on function public.cashout_quotes(bigint[]) to authenticated;
