-- Notificação de rodadas grátis sem o valor da rodada (o jogo define)
CREATE OR REPLACE FUNCTION public._grant_reward(p_user uuid, p_kind text, p_value numeric, p_title text, p_source text)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_id bigint; v_days int := coalesce((public._setting('reward_days'))::text::int, 7);
  v_sv numeric := coalesce((public._setting('freespin_value'))::text::numeric, 0.10);
begin
  if p_kind = 'freebet' then
    insert into public.user_rewards (user_id, kind, title, amount, min_odd, source, expires_at)
    values (p_user, 'freebet', p_title, p_value, coalesce((public._setting('freebet_min_odd'))::text::numeric, 1.5), p_source, now() + make_interval(days => v_days))
    returning id into v_id;
  else
    insert into public.user_rewards (user_id, kind, title, amount, spins, spins_left, max_win, source, expires_at)
    values (p_user, 'freespins', p_title, v_sv, p_value::int, p_value::int, coalesce((public._setting('freespin_max_win'))::text::numeric, 50), p_source,
            now() + make_interval(days => v_days))
    returning id into v_id;
  end if;
  insert into public.notifications (user_id, title, body) values (p_user, 'Você ganhou: ' || p_title,
    case when p_kind = 'freebet' then format('Use em Minha conta → Bônus ou no bilhete. Odd mínima %s, válida por %s dias. O lucro vai para o saldo, sem rollover.',
      coalesce((public._setting('freebet_min_odd'))::text, '1.5'), v_days)
    else format('Escolha o jogo em Minha conta → Bônus. As rodadas aparecem dentro do jogo e valem por %s dias. O que ganhar vai para o saldo, sem rollover.', v_days) end);
  return v_id;
end $function$;

update public.notifications
   set body = regexp_replace(body, 'Rodadas de R\$ [0-9.,]+, válidas por ([0-9]+) dias\.', 'As rodadas aparecem dentro do jogo e valem por \1 dias.')
 where body ~ 'Rodadas de R\$ [0-9.,]+, válidas por';
