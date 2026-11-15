-- Admin → Sugestões → "Perguntar de novo": cada clique abre a janela mais uma vez para todos os jogadores
insert into public.settings (key, value, label) values ('feedback_round', '1', 'Rodada da janela "O que podemos melhorar?"')
on conflict (key) do nothing;

create or replace function public.feedback_round() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::int from public.settings where key = 'feedback_round'), 1);
$$;

create or replace function public.admin_feedback_ask() returns int
language plpgsql security definer set search_path = public as $$
declare v_old int; v_new int;
begin
  perform public._require_perm('settings.manage');
  v_old := public.feedback_round();
  v_new := v_old + 1;
  insert into public.settings (key, value, label, updated_at, updated_by)
    values ('feedback_round', to_jsonb(v_new), 'Rodada da janela "O que podemos melhorar?"', now(), auth.uid())
    on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform public._audit('config.alterar', 'setting', 'feedback_round', null, jsonb_build_object('value', v_old), jsonb_build_object('value', v_new));
  return v_new;
end $$;

revoke all on function public.feedback_round() from public, anon;
revoke all on function public.admin_feedback_ask() from public, anon;
grant execute on function public.feedback_round() to authenticated;
grant execute on function public.admin_feedback_ask() to authenticated, service_role;
notify pgrst, 'reload schema';
