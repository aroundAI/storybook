-- KB-137: fifteen policies filter through a subquery on accounts or
-- accounts_memberships with a bare auth.uid(). Inlined, that is a
-- text-to-uuid cast Postgres will not apply ahead of the subquery table's
-- own policies, so each read scanned every account in the database and ran
-- is_mfa_compliant() and has_role_on_account() on each one before comparing
-- ids. Measured on the local-CI database (592 accounts): reading one social
-- post as its owner took 4.0 s, half the authenticated role's 8 s
-- statement_timeout. Under a loaded run it went past it, PostgREST answered
-- 500, and the action reported "Social post not found".
--
-- `(select auth.uid())` is evaluated once, as an InitPlan, so the id
-- comparison becomes an index condition and the subquery table's policies
-- run on the one matching row: the same read takes 1.4 ms. The rule is
-- unchanged; each statement below is the live policy with only that
-- substitution (generated from pg_policies and reviewed).

alter policy account_oauth_apps_delete on public.account_oauth_apps
  using ((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE ((accounts_memberships.user_id = (select auth.uid())) AND ((accounts_memberships.account_role)::text = 'owner'::text)))));

alter policy account_oauth_apps_insert on public.account_oauth_apps
  with check ((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE ((accounts_memberships.user_id = (select auth.uid())) AND ((accounts_memberships.account_role)::text = 'owner'::text)))));

alter policy account_oauth_apps_select on public.account_oauth_apps
  using ((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))));

alter policy account_oauth_apps_update on public.account_oauth_apps
  using ((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE ((accounts_memberships.user_id = (select auth.uid())) AND ((accounts_memberships.account_role)::text = 'owner'::text)))));

alter policy "Users can insert batch jobs for their accounts" on public.batch_generation_jobs
  with check (((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))) OR (account_id = (select auth.uid()))));

alter policy "Users can update batch jobs for their accounts" on public.batch_generation_jobs
  using (((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))) OR (account_id = (select auth.uid()))));

alter policy "Users can view batch jobs for their accounts" on public.batch_generation_jobs
  using (((account_id IN ( SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))) OR (account_id = (select auth.uid()))));

alter policy project_templates_create on public.project_templates
  with check (((is_system = false) AND (account_id IN ( SELECT a.id
   FROM accounts a
  WHERE ((a.primary_owner_user_id = (select auth.uid())) OR has_role_on_account(a.id))))));

alter policy project_templates_delete on public.project_templates
  using (((is_system = false) AND (account_id IN ( SELECT a.id
   FROM accounts a
  WHERE ((a.primary_owner_user_id = (select auth.uid())) OR has_role_on_account(a.id))))));

alter policy project_templates_read on public.project_templates
  using (((deleted_at IS NULL) AND ((is_system = true) OR (account_id IN ( SELECT a.id
   FROM accounts a
  WHERE ((a.primary_owner_user_id = (select auth.uid())) OR has_role_on_account(a.id)))))));

alter policy project_templates_update on public.project_templates
  using (((is_system = false) AND (deleted_at IS NULL) AND (account_id IN ( SELECT a.id
   FROM accounts a
  WHERE ((a.primary_owner_user_id = (select auth.uid())) OR has_role_on_account(a.id))))));

alter policy social_posts_delete on public.social_posts
  using (((account_id IN ( SELECT accounts.id
   FROM accounts
  WHERE (accounts.id = (select auth.uid()))
UNION ALL
 SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))) AND ((status)::text <> 'published'::text)));

alter policy social_posts_insert on public.social_posts
  with check ((account_id IN ( SELECT accounts.id
   FROM accounts
  WHERE (accounts.id = (select auth.uid()))
UNION ALL
 SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))));

alter policy social_posts_select on public.social_posts
  using ((account_id IN ( SELECT accounts.id
   FROM accounts
  WHERE (accounts.id = (select auth.uid()))
UNION ALL
 SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))));

alter policy social_posts_update on public.social_posts
  using ((account_id IN ( SELECT accounts.id
   FROM accounts
  WHERE (accounts.id = (select auth.uid()))
UNION ALL
 SELECT accounts_memberships.account_id
   FROM accounts_memberships
  WHERE (accounts_memberships.user_id = (select auth.uid())))));

