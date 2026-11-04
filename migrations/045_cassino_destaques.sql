-- =====================================================
--  045 — Cassino: jogos em destaque escolhidos no Admin
--  casino_catalog.featured = posição na faixa "Em destaque" (null = fora).
-- =====================================================
alter table public.casino_catalog add column if not exists featured int;
create index if not exists casino_catalog_featured on public.casino_catalog (featured) where featured is not null;

create or replace function public.admin_casino_feature(p_id text, p_featured int) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  perform public._require_perm('casino.manage');
  update public.casino_catalog set featured = p_featured, updated_at = now() where id = p_id returning name into v_name;
  if not found then raise exception 'Jogo não encontrado'; end if;
  perform public._audit('cassino.destaque', 'casino_game', p_id, null, null, jsonb_build_object('jogo', v_name, 'posicao', p_featured));
end $$;
revoke all on function public.admin_casino_feature(text, int) from public, anon;
grant execute on function public.admin_casino_feature(text, int) to authenticated;
