-- 089: avisos em tempo real via Broadcast (canais privados) no lugar de postgres_changes.
-- postgres_changes faz o Realtime ler o WAL do banco a cada ~0,4 s (72% do tempo do banco: o WAL é inflado
-- pelos updates de matches). Broadcast só grava uma linha em realtime.messages por evento.
--   user:<uuid>  → notif (nova notificação), tx (mudança de status de transação do próprio usuário)
--   admin        → alert (insert/update em alerts; só o id: o texto é lido via RLS de alerts), tx / bet (algo mudou; o painel recarrega)

create or replace function public._rt_user_notif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null then
    perform realtime.send(jsonb_build_object('id', new.id, 'title', new.title), 'notif', 'user:' || new.user_id, true);
  end if;
  return null;
end $$;

create or replace function public._rt_user_tx() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    perform realtime.send(jsonb_build_object('id', new.id, 'type', new.type, 'status', new.status),
                          'tx', 'user:' || new.user_id, true);
  end if;
  return null;
end $$;

create or replace function public._rt_admin_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(jsonb_build_object('op', tg_op, 'alert_id', new.id), 'alert', 'admin', true);
  return null;
end $$;

-- por comando (não por linha): liquidação em lote gera um aviso só
create or replace function public._rt_admin_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send('{}'::jsonb, tg_argv[0], 'admin', true);
  return null;
end $$;

revoke all on function public._rt_user_notif(), public._rt_user_tx(), public._rt_admin_alert(), public._rt_admin_touch() from public, anon, authenticated;

drop trigger if exists rt_user_notif on public.notifications;
create trigger rt_user_notif after insert on public.notifications for each row execute function public._rt_user_notif();
drop trigger if exists rt_user_tx on public.transactions;
create trigger rt_user_tx after update of status on public.transactions for each row execute function public._rt_user_tx();
drop trigger if exists rt_admin_alert on public.alerts;
create trigger rt_admin_alert after insert or update on public.alerts for each row execute function public._rt_admin_alert();
drop trigger if exists rt_admin_tx on public.transactions;
create trigger rt_admin_tx after insert or update or delete on public.transactions for each statement execute function public._rt_admin_touch('tx');
drop trigger if exists rt_admin_bet on public.bets;
create trigger rt_admin_bet after insert or update or delete on public.bets for each statement execute function public._rt_admin_touch('bet');

-- quem pode ouvir cada canal privado
drop policy if exists rt_read on realtime.messages;
create policy rt_read on realtime.messages for select to authenticated using (
  realtime.messages.extension = 'broadcast' and (
    realtime.topic() = 'user:' || auth.uid()::text
    or (realtime.topic() = 'admin' and (public.has_perm('alerts.view') or public.has_perm('finance.view') or public.has_perm('users.view')))
  ));
