-- Rodadas grátis só em jogos que a PlayFiver libera nativamente (campo rounds_free do /games).
alter table public.casino_catalog add column if not exists pf_free boolean not null default false;

create or replace function public.freespin_games() returns setof public.casino_catalog
language plpgsql stable security definer set search_path = public as $$
declare v_fix jsonb := coalesce(public._setting('freespin_games'), '[]');
begin
  if jsonb_array_length(v_fix) > 0 then
    return query select c.* from public.casino_catalog c where c.active and c.pf_free and c.id in (select jsonb_array_elements_text(v_fix)) limit 5;
    return;
  end if;
  -- jogos com rodadas grátis nativas na PlayFiver, de estúdio ativo, sorteados por dia (Pragmatic e PG primeiro)
  return query select c.* from public.casino_catalog c join public.casino_providers p on p.id = c.provider
    where c.active and p.active and c.pf_free and c.image is not null
    order by (c.pf_provider in ('PRAGMATIC','PGSOFT')) desc, md5(c.id || public._today()::text) limit 5;
end $$;

-- pacote ainda não começado num jogo sem suporte volta pra escolha
update public.user_rewards u set status = 'disponivel', game_id = null, game_name = null, pf_grant_msg = null
 where u.kind = 'freespins' and u.status = 'em_uso' and u.spins_left = u.spins and u.pf_granted_at is null
   and not exists (select 1 from public.casino_catalog c where c.id = u.game_id and c.pf_free);

notify pgrst, 'reload schema';
