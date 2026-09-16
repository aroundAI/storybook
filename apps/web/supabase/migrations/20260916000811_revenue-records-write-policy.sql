-- Who may write a revenue row, stated once.
--
-- Two defects, both proven against a real database before this was written
-- (`supabase/tests/database/revenue-records-rls.test.sql`, red on exactly
-- these two cases and green after):
--
-- 1. `revenue_records_create` never constrained `created_by`, so a member
--    could insert a row attributed to a colleague — handing them edit rights
--    over it and taking the author's own away. `created_by` is what the
--    update and delete policies authorize on, so naming someone else is a
--    way of rewriting who those policies answer to.
--
-- 2. `revenue_records_update`'s WITH CHECK was `source = 'manual'` and
--    nothing else, so the same member could reassign `created_by` on a row
--    they already owned. Nothing looked at it: the read policy does not
--    mention the column.
--
-- What this is NOT. A review reported that the narrow WITH CHECK also let a
-- member repoint `account_id` at another tenant. It does not, and the claim
-- was the result of reading the policies rather than running them. Postgres
-- applies the SELECT policy to the row an UPDATE produces, and
-- `revenue_records_read` requires `has_account_access` on the new
-- `account_id`, so the cross-tenant move was already refused — verified on
-- PostgreSQL 17.6, with and without RETURNING, by widening each policy in
-- turn. The write policy states the rule regardless: an authorization rule
-- that holds only as a side effect of a read rule is one edit away from not
-- holding, and nothing would fail when it stopped.
--
-- Stated once, because the rule previously lived in three places
-- (update USING, update WITH CHECK, delete USING) and the divergence between
-- two of them is the whole of defect 2.

create or replace function public.can_write_revenue_record(
  target_publish_id uuid,
  target_account_id uuid,
  record_author uuid
)
returns boolean
language sql
stable
-- Security invoker, unlike `has_account_access`: the expression this replaces
-- was inline in the policy and so read `project_members` under the caller's
-- own RLS. A definer function would quietly widen that, which is not a change
-- this migration is making.
security invoker
set search_path = ''
as $$
  select
    (
      target_account_id is not null
      and (
        public.is_account_owner(target_account_id)
        or public.has_role_on_account(target_account_id, 'owner')
        or record_author = (select auth.uid())
      )
    )
    or exists (
      select 1
      from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = target_publish_id
        and pm.user_id = (select auth.uid())
        and pm.role in ('owner', 'admin', 'member')
    );
$$;

comment on function public.can_write_revenue_record(uuid, uuid, uuid) is
  'Channel-level revenue may be changed by an account owner or by the person who recorded it; per-video revenue by any member of the publish''s project. The single definition behind revenue_records update and delete.';

grant execute on function public.can_write_revenue_record(uuid, uuid, uuid) to authenticated;

-- ==================================
-- Create
-- ==================================

drop policy if exists "revenue_records_create" on public.revenue_records;

create policy "revenue_records_create" on public.revenue_records for insert
  to authenticated with check (
    source = 'manual'
    -- Null stays permitted, matching `verified_facts`: a row with no author
    -- is owner-only for good, which is the safe way to be wrong about
    -- authorship. Naming somebody else is not.
    and (created_by is null or created_by = (select auth.uid()))
    and (
      (
        account_id is not null
        and public.has_account_access(account_id)
      )
      or exists (
        select 1
        from public.publishes pub
        join public.episodes e on e.id = pub.episode_id
        join public.project_members pm on pm.project_id = e.project_id
        where pub.id = revenue_records.publish_id
          and pm.user_id = (select auth.uid())
          and pm.role in ('owner', 'admin', 'member')
      )
    )
  );

-- ==================================
-- Update
-- ==================================

drop policy if exists "revenue_records_update" on public.revenue_records;

create policy "revenue_records_update" on public.revenue_records for update
  to authenticated
  using (
    public.can_write_revenue_record(publish_id, account_id, created_by)
  )
  with check (
    -- The same rule against the *new* row. Postgres uses USING for both only
    -- when WITH CHECK is absent, so naming one silently drops the other —
    -- which is how `created_by` became writable.
    public.can_write_revenue_record(publish_id, account_id, created_by)
    -- Kept from 20260915193743: a row laundered from 'manual' to 'api' can
    -- never be removed through the app and is counted as a platform payout.
    and source = 'manual'
  );

-- ==================================
-- Delete
-- ==================================
-- The account branch is the same rule. The publish branch is deliberately
-- stricter than update — project owner or admin, or the author — so it keeps
-- its own expression rather than calling the shared function.

drop policy if exists "revenue_records_delete" on public.revenue_records;

create policy "revenue_records_delete" on public.revenue_records for delete
  to authenticated using (
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
  );
