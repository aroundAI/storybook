-- ==================================
-- Change log: a tag belongs to the change's account (KB-93), and a change
-- is deleted only while planned or abandoned (KB-7)
-- ==================================
-- Both policies only narrow what was allowed; nothing is loosened, and the
-- lifecycle guard (guard_experiment_lifecycle) is untouched.

-- KB-93. The insert policy checked access to the experiment only, so a user
-- in two accounts could link one account's tag to the other's change —
-- reproduced through RLS on 2026-09-24. The same rule experiment_publishes
-- got in 20260918203816.
drop policy "experiment_tags_create" on public.experiment_tags;

create policy "experiment_tags_create" on public.experiment_tags for insert
  to authenticated with check (
    exists (
      select 1
        from public.analytics_experiments e
        join public.content_tags t on t.id = experiment_tags.tag_id
       where e.id = experiment_tags.experiment_id
         and public.has_account_access(e.account_id)
         and t.account_id = e.account_id
    )
  );

-- KB-7, decided by the owner on 2026-09-24. A running change is abandoned
-- first, which keeps its record; a concluded change is the record the log
-- exists to keep. Removing an account still removes its changes: foreign-key
-- cascades do not go through RLS.
drop policy "analytics_experiments_delete" on public.analytics_experiments;

create policy "analytics_experiments_delete" on public.analytics_experiments for delete
  to authenticated using (
    public.has_account_access(account_id)
    and status in ('planned', 'abandoned')
  );
