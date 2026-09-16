-- Round 11, on the round-10 migration. Three holes, all on the branch round 10
-- did not cover, and all proven before this was written
-- (`supabase/tests/database/revenue-records-rls.test.sql`).
--
-- 1. **A synced row could be laundered into a hand-entered one.** The UPDATE
--    policy's USING clause had no `source` predicate, and WITH CHECK only
--    required the *new* row to say `source = 'manual'`. So any project member
--    could PATCH the platform's `api` row to an arbitrary figure: USING passed
--    on the old row, WITH CHECK passed on the new one. The row stays
--    `category = 'ads'`, so it still counts as a platform payout in the
--    ad-share signal — and because 20260915195006 put `source` in the unique
--    index, the next sync no longer finds an 'api' row for that key and
--    inserts a fresh one, so the day is then counted twice, permanently.
--
--    20260916000811's header reasoned about `manual -> api` and left
--    `api -> manual` open. Both directions are now closed, and in USING rather
--    than WITH CHECK: the point is that a synced row is not this app's to
--    select for update at all.
--
-- 2. **The same on delete.** `deleteManualRevenueAction` filters to
--    `source = 'manual'`; PostgREST did not have to. A project owner or admin
--    could delete the platform's rows outright. (A plain member could not —
--    the role check already refused them — so this is narrower than the
--    update hole, but it is the same rule left unstated.)
--
-- 3. **`created_by` was freely reassignable on publish-scoped rows.**
--    `can_write_revenue_record`'s publish branch ignores its `record_author`
--    argument by design — any project member may correct per-video revenue —
--    so the WITH CHECK added in 20260916000811 constrained authorship on the
--    account branch only, while that migration's header claimed the defect
--    fixed outright. It was half fixed.
--
--    This is an escalation, not just bad attribution: `revenue_records_delete`
--    grants removal to `created_by`, so a member who pins a colleague's row on
--    themselves gains a delete right that otherwise needs project owner or
--    admin.
--
--    Fixed with a trigger rather than another policy clause, because a policy
--    cannot see OLD. That also makes the rule total — one statement covering
--    both branches and the service-role client — instead of a third place
--    where the same idea has to be restated and kept in step.

-- ==================================
-- `source` is not the app's to change
-- ==================================

drop policy if exists "revenue_records_update" on public.revenue_records;

create policy "revenue_records_update" on public.revenue_records for update
  to authenticated
  using (
    -- A synced row is the platform's record of what it paid. Nothing reached
    -- through an end-user JWT may edit one; the sync writes through the
    -- service-role client, which bypasses RLS.
    source = 'manual'
    and public.can_write_revenue_record(publish_id, account_id, created_by)
  )
  with check (
    source = 'manual'
    and public.can_write_revenue_record(publish_id, account_id, created_by)
  );

drop policy if exists "revenue_records_delete" on public.revenue_records;

create policy "revenue_records_delete" on public.revenue_records for delete
  to authenticated using (
    source = 'manual'
    and (
      (
        account_id is not null
        and (
          public.is_account_owner(account_id)
          or public.has_role_on_account(account_id, 'owner')
          or created_by = (select auth.uid())
        )
      )
      or exists (
        select 1
        from public.publishes pub
        join public.episodes e on e.id = pub.episode_id
        join public.project_members pm on pm.project_id = e.project_id
        where pub.id = revenue_records.publish_id
          and pm.user_id = (select auth.uid())
          and (
            pm.role in ('owner', 'admin')
            or revenue_records.created_by = (select auth.uid())
          )
      )
    )
  );

-- ==================================
-- Authorship is written once
-- ==================================

create or replace function public.revenue_records_freeze_created_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.created_by is distinct from old.created_by then
    raise exception 'revenue_records.created_by is immutable'
      using hint = 'Authorship is recorded on insert. A correction does not transfer it.';
  end if;

  return new;
end;
$$;

comment on function public.revenue_records_freeze_created_by() is
  'Rejects any UPDATE that changes revenue_records.created_by. The update and delete policies authorize on that column, so letting a writer change it lets them change who those policies answer to.';

-- Dropped first, like the policies above: `create trigger` has no
-- `if not exists`, and a migration that cannot be re-run is a migration you
-- cannot test twice.
drop trigger if exists revenue_records_freeze_created_by on public.revenue_records;

create trigger revenue_records_freeze_created_by
  before update on public.revenue_records
  for each row
  execute function public.revenue_records_freeze_created_by();

-- Deliberately total, including the service-role client: no code path sets
-- `created_by` on update (`addManualRevenueAction` excludes it, and the sync
-- never names it), so nothing legitimate is affected. A future backfill that
-- attributes legacy null rows has to disable this trigger explicitly, which is
-- the right amount of friction for rewriting provenance.

-- ==================================
-- What 20260915195006 changed about totals, reported rather than assumed
-- ==================================
-- Putting `source` in the unique index was a deliberate model change: a synced
-- figure and a hand-entered one are different money, so they coexist and sum.
-- Before it, the sync overwrote whatever held the slot, so a key carried one
-- row. Any key that already held a hand-entered row in a category the sync
-- also writes will therefore report a *larger* total the next time the sync
-- visits that date — not a bug, but not a no-op either, and nobody had checked
-- whether such rows exist.
--
-- Both counts are zero on a local database. This reports them wherever the
-- migration is applied, so the number comes from the database being migrated
-- rather than from an assumption about it.
do $$
declare
  overlapping int;
  legacy_payout int;
begin
  select count(*) into overlapping from (
    select 1
    from public.revenue_records
    group by coalesce(publish_id, account_id), record_date, category
    having count(*) filter (where source = 'api') > 0
       and count(*) filter (where source <> 'api') > 0
  ) t;

  select count(*) into legacy_payout
  from public.revenue_records
  where source <> 'api' and category in ('ads', 'premium');

  if overlapping > 0 then
    raise notice
      'revenue_records: % (scope, date, category) keys now hold both a synced and a hand-entered row. Their totals are the sum of the two; before 20260915195006 one overwrote the other.',
      overlapping;
  end if;

  if legacy_payout > 0 then
    raise notice
      'revenue_records: % hand-entered rows sit in ads/premium, from before the form dropped those options. They are read as "other" by effectiveRevenueCategory so they no longer inflate adsSharePercent; the rows are left as entered.',
      legacy_payout;
  end if;
end $$;
