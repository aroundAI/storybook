-- Channel-level revenue: any member records, only an owner rewrites.
--
-- `revenue_records_create/update/delete` all used the same account branch,
-- `has_account_access(account_id)`, which is true for the primary owner or
-- any membership row regardless of role. So the lowest-privileged member of
-- an account could overwrite or delete channel revenue, while the publish
-- branch of the same file already required 'owner'/'admin' to delete.
--
-- Create stays open: recording revenue is ordinary team work. Update and
-- delete do not, because replacement is silent — one row per
-- (coalesce(publish_id, account_id), record_date, category), overwritten in
-- place — so a wrong figure replaces a right one with a success toast.
--
-- There is no account-level `admin`: `17-roles-seed.sql` seeds only 'owner'
-- and 'member', so this is owner-or-nothing. Both checks are needed —
-- `is_account_owner` reads `accounts.primary_owner_user_id` while
-- `has_role_on_account` reads the membership row, and neither implies the
-- other.
--
-- The analytics sync is unaffected: it writes through the service-role
-- client, which bypasses RLS, and only ever sets publish_id.

alter table public.revenue_records enable row level security;

drop policy if exists "revenue_records_update" on public.revenue_records;

create policy "revenue_records_update" on public.revenue_records for update
  to authenticated using (
    (
      account_id is not null
      and (
        public.is_account_owner(account_id)
        or public.has_role_on_account(account_id, 'owner')
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
