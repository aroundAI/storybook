-- KB-52: every signed-in user could read, rewrite, forge and delete every
-- account's llm_usage_analytics rows.
--
-- "Service role can manage LLM analytics" was written with no FOR and no TO
-- clause and `using (true) with check (true)`, so it applied FOR ALL TO
-- public. service_role bypasses RLS and never needed it; the only roles it
-- ever admitted were everyone else. anon and authenticated also held every
-- table privilege (Supabase's default grants), so that policy was the only
-- barrier. The read policy beside it delegated to accounts' own RLS, which
-- admits more than account membership.
--
-- Now: reads on account access — owner or member, via has_account_access, so
-- a personal account's owner (who has no membership row) sees their own
-- usage. Writes by the service role only, enforced twice: no write policy,
-- and no write privilege for anon or authenticated, so a future permissive
-- policy alone cannot reopen writes. executeLLM logs through the service-role
-- client for every caller (packages/features/prompt-engine), which is what
-- keeps the three callers that used to log through the user's own session
-- from losing their rows.
--
-- Tests: tests/database/llm-usage-analytics-rls.test.sql and
-- tests/database/policy-shape.test.sql (the class guard).

drop policy "Service role can manage LLM analytics" on public.llm_usage_analytics;
drop policy "Admins can view all LLM analytics" on public.llm_usage_analytics;

create policy llm_usage_analytics_read on public.llm_usage_analytics
  for select
  to authenticated
  using (public.has_account_access(account_id));

revoke all on public.llm_usage_analytics from anon, authenticated;
grant select on public.llm_usage_analytics to authenticated;
grant select, insert, update, delete on public.llm_usage_analytics to service_role;

-- The same missing TO clause on five more tables that hold account or user
-- data. Their predicates all test auth.uid(), so today they expose nothing —
-- anon has no USAGE on this schema, and any other role has a null auth.uid().
-- Naming the role changes no one's access; it lets the class guard in
-- policy-shape.test.sql fail CI on the next policy written without one.
-- Only the role list changes here, never a predicate. verified_facts and
-- audio_cues have the same shape and are left to KB-18 and KB-27, which are
-- rewriting those policies.

alter policy social_posts_select on public.social_posts to authenticated;
alter policy social_posts_insert on public.social_posts to authenticated;
alter policy social_posts_update on public.social_posts to authenticated;
alter policy social_posts_delete on public.social_posts to authenticated;

alter policy "Users can view batch jobs for their accounts" on public.batch_generation_jobs to authenticated;
alter policy "Users can insert batch jobs for their accounts" on public.batch_generation_jobs to authenticated;
alter policy "Users can update batch jobs for their accounts" on public.batch_generation_jobs to authenticated;

alter policy "Users can view transitions for accessible episodes" on public.shot_transitions to authenticated;
alter policy "Users can insert transitions for accessible episodes" on public.shot_transitions to authenticated;
alter policy "Users can update transitions for accessible episodes" on public.shot_transitions to authenticated;
alter policy "Users can delete transitions for accessible episodes" on public.shot_transitions to authenticated;

alter policy audio_assets_select_policy on public.audio_assets to authenticated;
alter policy audio_assets_insert_policy on public.audio_assets to authenticated;
alter policy audio_assets_update_policy on public.audio_assets to authenticated;
alter policy audio_assets_delete_policy on public.audio_assets to authenticated;

alter policy "Users can read their own nonces" on public.nonces to authenticated;
