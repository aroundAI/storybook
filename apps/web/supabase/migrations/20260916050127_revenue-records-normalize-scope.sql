-- `not valid` postponed a scan, not the rule.
--
-- 20260915195006 added `revenue_records_single_scope_check ... not valid`,
-- reasoning that legacy rows carrying both `publish_id` and `account_id` would
-- be "left alone rather than blocking the migration". That is true of the
-- migration and false of everything afterwards: NOT VALID skips the initial
-- scan, but the constraint is enforced on every later UPDATE of an existing
-- row. Proven against a real database — a dual-scope row updated the way
-- `upsertRevenueRecords` updates (by id, setting `publish_id`, never touching
-- `account_id`) fails with 23514.
--
-- The consequence is silent and permanent. `analytics-sync-cron.ts` logs that
-- error at warn and continues, so the row is never corrected and that
-- publish/date/category's revenue stops being recorded, with nothing failing.
--
-- So: normalize rather than postpone. A dual-scope row belongs to its publish,
-- which is not a new decision — `idx_revenue_records_unique_scope` coalesces to
-- `publish_id`, `forEachAccountRevenueRow`'s channel branch filters
-- `publish_id is null` so these rows only ever reach the publish branch, and
-- `addManualRevenueAction` says so in as many words. Clearing `account_id`
-- writes down what every reader already believes.
--
-- **Totals are unchanged by this**, which is the property that makes it safe:
-- the row was already counted once, through the publish branch, and it still
-- is. Nothing moves between scopes.

do $$
declare
  dual_scope int;
begin
  select count(*) into dual_scope
  from public.revenue_records
  where publish_id is not null and account_id is not null;

  if dual_scope > 0 then
    raise notice
      'revenue_records: normalising % dual-scope rows to their publish. Each was already counted through the publish branch, so no total changes; what changes is that the sync can update them again.',
      dual_scope;
  end if;
end $$;

update public.revenue_records
   set account_id = null
 where publish_id is not null
   and account_id is not null;

-- Now it can be validated, so the database actually holds the invariant
-- instead of promising it for rows written from here on. This takes
-- SHARE UPDATE EXCLUSIVE, so reads and writes continue during the scan.
alter table public.revenue_records
  validate constraint revenue_records_single_scope_check;
