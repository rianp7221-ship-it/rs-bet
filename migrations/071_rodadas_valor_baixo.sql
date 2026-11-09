-- Rodadas grátis nativas só nos jogos em que a PlayFiver libera a rodada no valor mínimo
-- (medido em 09/11: Fortune Tiger e Fortune Dragon R$ 0,40; Fortune Ox, Mouse e Rabbit R$ 0,50; Gems Bonanza era R$ 2,40)
insert into public.settings(key, value) values
  ('freespin_games', '["pf:pf-1:126","pf:pf-1:1695365","pf:pf-1:98","pf:pf-1:68","pf:pf-1:1543462"]'::jsonb),
  ('freespin_native', 'true'::jsonb)
on conflict (key) do update set value = excluded.value;

update public.user_rewards u
   set status = 'disponivel', game_id = null, game_name = null, pf_grant_msg = null
 where u.kind = 'freespins' and u.status = 'em_uso' and u.spins_left = u.spins and u.pf_granted_at is null
   and not (u.game_id in (select jsonb_array_elements_text(public._setting('freespin_games'))));
