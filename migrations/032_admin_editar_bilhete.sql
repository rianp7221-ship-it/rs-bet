-- 032: Admin abre o bilhete e corrige cada seleção (ganhou / perdeu / devolvida / pendente).
-- Odd e retorno são recalculados só com as seleções não devolvidas; o saldo do jogador
-- recebe a diferença entre o que já foi pago e o novo resultado.

create or replace function public.admin_bet_edit(p_bet bigint, p_changes jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b public.bets; c jsonb; v_before jsonb; v_odd numeric; v_pot numeric; v_status text;
  v_old numeric; v_new numeric; v_diff numeric; v_bal numeric;
begin
  perform public._require_perm('sports.manage');
  if length(coalesce(trim(p_reason), '')) < 5 then raise exception 'Informe o motivo'; end if;
  if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) = 0 then raise exception 'Nenhuma alteração'; end if;
  select * into b from public.bets where id = p_bet for update;
  if not found then raise exception 'Bilhete não encontrado'; end if;
  if b.status = 'cashout' then raise exception 'Bilhete com cash out já pago não pode ser editado'; end if;

  -- quanto o jogador já recebeu por este bilhete
  v_old := case b.status when 'won' then b.potential when 'canceled' then b.stake else 0 end;
  select jsonb_build_object('status', b.status, 'odd', b.total_odd, 'retorno', b.potential,
           'selecoes', jsonb_agg(jsonb_build_object('id', id, 'status', status) order by id))
    into v_before from public.bet_selections where bet_id = p_bet;

  for c in select * from jsonb_array_elements(p_changes) loop
    if coalesce(c->>'status', '') not in ('pending', 'won', 'lost', 'canceled') then raise exception 'Status inválido'; end if;
    update public.bet_selections set status = c->>'status' where id = (c->>'id')::bigint and bet_id = p_bet;
    if not found then raise exception 'Seleção % não pertence ao bilhete', c->>'id'; end if;
  end loop;

  select exp(sum(ln(odd))) into v_odd from public.bet_selections where bet_id = p_bet and status <> 'canceled';
  if v_odd is null then
    v_status := 'canceled'; v_odd := 1; v_pot := b.stake; v_new := b.stake;
  else
    v_pot := round(b.stake * v_odd, 2);
    if exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'lost') then v_status := 'lost'; v_new := 0;
    elsif exists (select 1 from public.bet_selections where bet_id = p_bet and status = 'pending') then v_status := 'pending'; v_new := 0;
    else v_status := 'won'; v_new := v_pot;
    end if;
  end if;

  update public.bets set status = v_status, total_odd = round(v_odd, 2), potential = v_pot,
         settled_at = case when v_status = 'pending' then null else coalesce(settled_at, now()) end
   where id = p_bet;

  v_diff := v_new - v_old;
  if v_diff < 0 then
    select balance into v_bal from public.profiles where id = b.user_id;
    if v_bal + v_diff < 0 then
      raise exception 'Saldo do jogador (R$ %) não cobre o estorno de R$ %', v_bal, -v_diff;
    end if;
  end if;
  if v_diff <> 0 then
    perform public._move(b.user_id, v_diff, 'adjust', format('Correção do bilhete #%s: %s', p_bet, trim(p_reason)));
  end if;

  insert into public.notifications (user_id, title, body, created_by)
  values (b.user_id, 'Bilhete #' || p_bet || ' corrigido',
          format('Seu bilhete foi revisado: %s, odd %s, retorno R$ %s. Motivo: %s',
                 case v_status when 'won' then 'ganhou' when 'lost' then 'perdeu' when 'canceled' then 'devolvido' else 'em aberto' end,
                 round(v_odd, 2), v_pot, trim(p_reason)), auth.uid());

  perform public._audit('bilhete.editar', 'bet', p_bet::text, p_reason, v_before,
    jsonb_build_object('status', v_status, 'odd', round(v_odd, 2), 'retorno', v_pot, 'ajuste_saldo', v_diff, 'alteracoes', p_changes));
  return jsonb_build_object('status', v_status, 'odd', round(v_odd, 2), 'retorno', v_pot, 'ajuste', v_diff);
end $$;

revoke execute on function public.admin_bet_edit(bigint, jsonb, text) from public, anon;
grant execute on function public.admin_bet_edit(bigint, jsonb, text) to authenticated;
