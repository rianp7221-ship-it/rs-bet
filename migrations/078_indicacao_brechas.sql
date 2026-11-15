-- Indicação e rollover: fecha brechas.
-- 1) Uma aposta conta para um bônus de cada vez (do mais antigo ao mais novo), não para todos ao mesmo tempo.
-- 2) Aposta esportiva só conta no rollover quando é resolvida como ganhou/perdeu (cash out e cancelada não contam).
-- 3) Indicação paga quando o amigo, depois do 1º depósito mínimo, soma apostas resolvidas >= referral_min_deposit.

alter table public.bets add column if not exists bonus_counted boolean not null default false;
-- apostas antigas já foram contadas no momento em que foram feitas
update public.bets set bonus_counted = true where not bonus_counted;

create or replace function public._bonus_wager(p_user uuid, p_amount numeric, p_odd numeric) returns void
language plpgsql security definer set search_path = public as $$
declare b public.user_bonuses; v_left numeric := greatest(coalesce(p_amount, 0), 0); v_use numeric;
begin
  for b in select * from public.user_bonuses where user_id = p_user and status = 'ativo' and expires_at > now()
             and (p_odd is null or p_odd >= min_odd) order by created_at, id for update loop
    v_use := least(v_left, greatest(b.wager_required - b.wagered, 0));
    update public.user_bonuses set wagered = wagered + v_use,
      status = case when wagered + v_use >= wager_required then 'concluido' else status end,
      finished_at = case when wagered + v_use >= wager_required then now() else finished_at end
    where id = b.id;
    v_left := v_left - v_use;
    exit when v_left <= 0;
  end loop;
end $$;

create or replace function public._referral_check(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.profiles; v_min numeric := coalesce((public._setting('referral_min_deposit'))::text::numeric, 0); v_dep numeric; v_bet numeric;
begin
  select * into p from public.profiles where id = p_user;
  if p.referred_by is null or p.referred_by = p.id then return; end if;
  if exists (select 1 from public.user_bonuses where source = 'indicacao:' || p.id) then return; end if;
  select amount into v_dep from public.transactions where user_id = p.id and type = 'deposit' and status = 'done' order by created_at, id limit 1;
  if v_dep is null or v_dep < v_min then return; end if;
  select coalesce(sum(stake), 0) into v_bet from public.bets where user_id = p.id and freebet_id is null and status in ('won','lost');
  v_bet := v_bet + coalesce((select -sum(amount) from public.transactions where user_id = p.id and type = 'casino_bet' and status = 'done'), 0);
  if v_bet < v_min then return; end if;
  perform public._grant_bonus(p.referred_by, null, 'indicacao', coalesce((public._setting('referral_reward'))::text::numeric, 0),
    coalesce((public._setting('referral_rollover'))::text::numeric, 1), 1.5, 30, 'indicação de ' || coalesce(p.username, 'amigo'), 'indicacao:' || p.id);
end $$;
revoke execute on function public._referral_check(uuid) from public, anon, authenticated;

create or replace function public._bonus_on_bet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.freebet_id is not null or new.bonus_counted or new.status not in ('won','lost') then return new; end if;
  update public.bets set bonus_counted = true where id = new.id;
  perform public._bonus_wager(new.user_id, new.stake, new.total_odd);
  perform public._referral_check(new.user_id);
  return new;
end $$;
drop trigger if exists bonus_on_bet on public.bets;
create trigger bonus_on_bet after update of status on public.bets for each row execute function public._bonus_on_bet();

create or replace function public._bonus_on_tx() returns trigger
language plpgsql security definer set search_path = public as $$
declare b public.user_bonuses; c public.bonus_campaigns; v_amt numeric; v_used boolean := false;
begin
  if tg_op = 'INSERT' and new.type = 'casino_bet' and new.status = 'done' then
    perform public._bonus_wager(new.user_id, -new.amount, null);
    perform public._referral_check(new.user_id);
    return new;
  end if;
  if new.type <> 'deposit' or new.status <> 'done' or (tg_op = 'UPDATE' and old.status = 'done') then return new; end if;
  -- cupom aguardando depósito
  for b in select * from public.user_bonuses where user_id = new.user_id and status = 'aguardando_deposito' and expires_at > now()
             order by created_at limit 1 for update loop
    select * into c from public.bonus_campaigns where id = b.campaign_id;
    if c.id is not null and new.amount >= c.min_deposit then
      v_amt := public._bonus_value(c, new.amount);
      update public.user_bonuses set status = 'ativo', amount = v_amt, wager_required = round(v_amt * c.rollover, 2),
             min_odd = c.min_odd, expires_at = now() + make_interval(days => c.valid_days) where id = b.id;
      perform public._move(new.user_id, v_amt, 'bonus', 'Bônus: ' || c.name);
      insert into public.notifications (user_id, title, body) values (new.user_id, 'Bônus creditado',
        format('Você recebeu R$ %s (%s). Aposte R$ %s em %s dias para liberar o saque.', v_amt, c.name, round(v_amt * c.rollover, 2), c.valid_days));
      v_used := true;
    end if;
  end loop;
  if exists (select 1 from public.transactions where user_id = new.user_id and type = 'deposit' and status = 'done' and id <> new.id) then return new; end if;
  -- 1º depósito: boas-vindas automático
  if not v_used then
    select * into c from public.bonus_campaigns where kind = 'boas_vindas' and active and code is null and min_deposit <= new.amount
      and (ends_at is null or ends_at > now()) and (max_uses is null or uses < max_uses) order by created_at desc limit 1;
    if c.id is not null and public._grant_bonus(new.user_id, c.id, c.kind, public._bonus_value(c, new.amount), c.rollover, c.min_odd, c.valid_days, c.name) is not null then
      update public.bonus_campaigns set uses = uses + 1 where id = c.id;
    end if;
  end if;
  -- indicação: paga quando o indicado também apostar (ver _referral_check)
  perform public._referral_check(new.user_id);
  return new;
end $$;

create or replace function public.my_referrals() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', left(auth.uid()::text, 8),
    'invited', (select count(*) from public.profiles where referred_by = auth.uid()),
    'qualified', (select count(*) from public.user_bonuses where user_id = auth.uid() and kind = 'indicacao'),
    'earned', (select coalesce(sum(amount), 0) from public.user_bonuses where user_id = auth.uid() and kind = 'indicacao'),
    'reward', (public._setting('referral_reward'))::text::numeric,
    'min', (public._setting('referral_min_deposit'))::text::numeric)
$$;

update public.settings set label = 'Depósito mínimo do indicado e quanto ele precisa apostar (apostas resolvidas) para liberar a indicação (R$)'
 where key = 'referral_min_deposit';
