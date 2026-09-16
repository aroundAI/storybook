-- `source` is load-bearing for authorization, so the database has to hold it.
--
-- This PR made `source` decide things: addManualRevenueAction refuses to
-- touch a row whose source is not 'manual', and deleteManualRevenueAction
-- only ever deletes 'manual' rows. But nothing stopped an authenticated
-- caller inserting `source: 'api'` straight through PostgREST with their own
-- JWT — a row that then occupies its (scope, date, category) slot forever,
-- can never be removed through the app, and is counted as a platform payout.
--
-- Which is the same argument the schema already makes about the category
-- list: a rule enforced only in the app is not enforced. It applies one
-- level down, to the column the app's rules are now keyed on.
--
-- The sync is unaffected: it writes through the service-role client, which
-- bypasses RLS entirely, and is the only thing that should ever write 'api'.

drop policy if exists "revenue_records_create" on public.revenue_records;

create policy "revenue_records_create" on public.revenue_records for insert
  to authenticated with check (
    source = 'manual'
    and (
      (
        account_id is not null
        and public.has_account_access(account_id)
      )
      or exists (
        select 1 from public.publishes pub
        join public.episodes e on e.id = pub.episode_id
        join public.project_members pm on pm.project_id = e.project_id
        where pub.id = revenue_records.publish_id
        and pm.user_id = auth.uid()
        and pm.role in ('owner', 'admin', 'member')
      )
    )
  );

-- The same on update, or a row could be laundered from 'manual' to 'api'
-- after the fact and become untouchable.
drop policy if exists "revenue_records_update" on public.revenue_records;

create policy "revenue_records_update" on public.revenue_records for update
  to authenticated using (
    (
      account_id is not null
      and (
        public.is_account_owner(account_id)
        or public.has_role_on_account(account_id, 'owner')
        or created_by = auth.uid()
      )
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  )
  with check (source = 'manual');

-- Delete: the author may remove what the author wrote, on either scope.
-- 20260915190043 gave that right to the account branch only, so a project
-- member could create a publish-scoped entry and update it but never delete
-- it — the same no-exit state that migration exists to close, left open on
-- the other branch.
drop policy if exists "revenue_records_delete" on public.revenue_records;

create policy "revenue_records_delete" on public.revenue_records for delete
  to authenticated using (
    (
      account_id is not null
      and (
        public.is_account_owner(account_id)
        or public.has_role_on_account(account_id, 'owner')
        or created_by = auth.uid()
      )
    )
    or exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = revenue_records.publish_id
      and pm.user_id = auth.uid()
      and (pm.role in ('owner', 'admin') or revenue_records.created_by = auth.uid())
    )
  );
