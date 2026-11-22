-- RLS: has_perm()/auth.uid() avaliados uma vez por consulta (initPlan), não uma vez por linha.
-- A lista de bilhetes do admin passava de 8 s (statement_timeout) e voltava vazia.

alter policy affiliates_read on public.affiliates
  using ((select has_perm('affiliates.manage')));
alter policy alerts_read on public.alerts
  using ((select has_perm('alerts.view')));
alter policy audit_read on public.audit_log
  using ((select has_perm('audit.view')));
alter policy banners_read on public.banners
  using (((active AND ((starts_at IS NULL) OR (starts_at <= now())) AND ((ends_at IS NULL) OR (ends_at > now()))) OR (select has_perm('bonus.view'))));
alter policy bet_requests_read on public.bet_requests
  using (((user_id = (select auth.uid())) OR (select has_perm('sports.view'))));
alter policy bet_selections_read on public.bet_selections
  using (((select has_perm('users.view')) OR (select has_perm('sports.view')) OR (EXISTS ( SELECT 1
   FROM bets b
  WHERE ((b.id = bet_selections.bet_id) AND (b.user_id = (select auth.uid())))))));
alter policy bets_read on public.bets
  using (((user_id = (select auth.uid())) OR (select has_perm('users.view')) OR (select has_perm('sports.view'))));
alter policy campaigns_read on public.bonus_campaigns
  using ((select has_perm('bonus.view')));
alter policy casino_read on public.casino_games
  using (((user_id = (select auth.uid())) OR (select has_perm('users.view'))));
alter policy casino_tx_read on public.casino_tx
  using (((user_id = (select auth.uid())) OR (select is_admin())));
alter policy chargebacks_read on public.chargebacks
  using (((select has_perm('chargeback.manage')) OR (select has_perm('finance.view'))));
alter policy device_logs_read on public.device_logs
  using ((select has_perm('users.view')));
alter policy kyc_read on public.kyc_documents
  using (((user_id = (select auth.uid())) OR (select has_perm('kyc.view'))));
alter policy matches_admin_delete on public.matches
  using ((select has_perm('sports.manage')));
alter policy matches_admin_insert on public.matches
  with check ((select has_perm('sports.manage')));
alter policy matches_admin_update on public.matches
  using ((select has_perm('sports.manage')))
  with check ((select has_perm('sports.manage')));
alter policy notifications_read on public.notifications
  using (((user_id = (select auth.uid())) OR (select has_perm('users.view'))));
alter policy pending_actions_read on public.pending_actions
  using ((select has_perm('users.balance')));
alter policy profiles_read on public.profiles
  using (((id = (select auth.uid())) OR (select has_perm('users.view'))));
alter policy settings_read on public.settings
  using (((select has_perm('kpi.view')) OR (select has_perm('settings.manage'))));
alter policy transactions_read on public.transactions
  using (((user_id = (select auth.uid())) OR (select has_perm('finance.view'))));
alter policy user_bonuses_read on public.user_bonuses
  using (((user_id = (select auth.uid())) OR (select has_perm('bonus.view'))));
alter policy user_limits_read on public.user_limits
  using (((user_id = (select auth.uid())) OR (select has_perm('users.view'))));
alter policy user_notes_read on public.user_notes
  using ((select has_perm('users.view')));
alter policy user_rewards_read on public.user_rewards
  using (((user_id = (select auth.uid())) OR (select has_perm('bonus.view'))));
alter policy wheel_spins_read on public.wheel_spins
  using (((user_id = (select auth.uid())) OR (select has_perm('bonus.view'))));

create index if not exists bets_created_idx on public.bets (created_at desc);
