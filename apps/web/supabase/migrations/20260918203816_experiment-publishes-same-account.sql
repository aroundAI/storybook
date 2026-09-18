-- ==================================
-- A linked video must belong to the experiment's account (FILM-1610 review)
-- ==================================
-- `experiment_publishes_create` checked access to the *experiment* only, so a
-- caller could link any publish they could see — including one from another
-- account they also belong to. Snapshots read linked videos from ClickHouse,
-- which has no RLS, so the link decides whose figures an experiment reports.
--
-- The server action refuses a foreign link, but PostgREST is reachable
-- directly by any authenticated client, so the table has to refuse it as well
-- (the rule 20260916180412 set for channel_analytics_settings).
--
-- The publish lookup runs under the caller's own RLS, so a publish they cannot
-- see fails the check too. Existing rows are untouched: this governs inserts,
-- and experiment_publishes grants no UPDATE.

drop policy "experiment_publishes_create" on public.experiment_publishes;

create policy "experiment_publishes_create" on public.experiment_publishes for insert
  to authenticated with check (
    exists (
      select 1
        from public.analytics_experiments e
        join public.publishes pub on pub.id = experiment_publishes.publish_id
        join public.episodes ep on ep.id = pub.episode_id
        join public.projects p on p.id = ep.project_id
       where e.id = experiment_publishes.experiment_id
         and public.has_account_access(e.account_id)
         and p.account_id = e.account_id
    )
  );
