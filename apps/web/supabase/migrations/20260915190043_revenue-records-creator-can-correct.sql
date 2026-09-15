-- Let a member correct what a member recorded.
--
-- 20260915150338 made channel-level update/delete owner-only, which closed
-- a real gap — any member could silently overwrite a figure — and opened a
-- worse one: the entry form is rendered to every member, so a member could
-- create a row and then not be able to fix their own typo or remove it.
-- The UI invited them into a state with no exit.
--
-- The property worth protecting was never "members cannot write", it was
-- "nobody rewrites someone else's figure unnoticed". That needs to know who
-- wrote it, which the table did not record.

alter table public.revenue_records
  add column if not exists created_by uuid references auth.users(id) on delete set null;

comment on column public.revenue_records.created_by is
  'Who recorded this row by hand. Null for rows written by the sync, and for rows that predate this column.';

-- Existing rows keep created_by null, so they stay owner-only. That is the
-- safe direction: nobody is granted rights over a row whose author is
-- unknown.
create index if not exists ix_revenue_records_created_by
  on public.revenue_records (created_by);

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
  );

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
      and pm.role in ('owner', 'admin')
    )
  );
