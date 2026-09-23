/*
 * KB-55: storage buckets the code writes to, which no migration created.
 * KB-56: the reports bucket refused personal-account owners.
 *
 * Every audio upload goes through the storage adapter, which follows
 * STORAGE_PROVIDER. On R2 (production) `audio` and `audio-assets` are key
 * prefixes in one bucket and always worked. On the Supabase provider (every
 * local and CI environment) they are buckets, and neither existed, so TTS,
 * voice previews, SFX, music and the audio library all failed with "Bucket
 * not found". This creates them, with the same write rule as project-assets.
 *
 * The MIME lists here are the lists in packages/features/storage/src/buckets.ts;
 * apps/web/app/api/storage/__tests__/storage-buckets.test.ts fails if they
 * drift. Tests: tests/database/media-report-storage-rls.test.sql.
 */

-- ------------------------------------------------------------------
-- Buckets
-- ------------------------------------------------------------------
-- Public like project-assets: the app stores and plays their public URLs,
-- and on R2 the whole bucket is public by URL anyway. `on conflict` also
-- corrects a bucket someone created by hand.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', true, 52428800, array['audio/mpeg']),
  ('audio-assets', 'audio-assets', true, 52428800, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'])
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------------
-- audio: project writers, on paths that name their project
-- ------------------------------------------------------------------
-- SFX and music are written with the user's client at `<projectId>/…`, so
-- the KB-28 rule applies as it does to project-assets. Dialogue
-- (`dialogue/<episodeId>/…`) and voice previews (`temp/<userId>/…`) are
-- written with the service role, which bypasses these policies; for any
-- signed-in user those paths resolve to no project and are refused.
create policy audio_select on storage.objects for select
to authenticated
using (bucket_id = 'audio');

create policy audio_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'audio'
  and public.can_write_project_storage(name)
);

create policy audio_update on storage.objects for update
to authenticated
using (
  bucket_id = 'audio'
  and public.can_write_project_storage(name)
)
with check (
  bucket_id = 'audio'
  and public.can_write_project_storage(name)
);

create policy audio_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'audio'
  and public.can_write_project_storage(name)
);

-- audio-assets has no policy for authenticated users on purpose: only the
-- server (service role) writes it, and it is read through public URLs. Its
-- keys carry no project id (`<type>/<ts>-<name>`), so no project rule could
-- be written here; KB-57 adds one.

-- ------------------------------------------------------------------
-- reports: owner or member of the account (KB-56), and only reports
-- ------------------------------------------------------------------
-- has_role_on_account() reads accounts_memberships, which has no row for a
-- personal account's owner, so they were refused their own exports.
-- has_account_access() is primary owner or member.
drop policy if exists reports_select on storage.objects;
drop policy if exists reports_insert on storage.objects;
drop policy if exists reports_delete on storage.objects;

create policy reports_select on storage.objects for select
to authenticated
using (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);

create policy reports_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);

create policy reports_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'reports'
  and public.has_account_access(kit.get_account_id_from_report_path(name))
);

-- Reports are CSV or PDF; nothing else belongs on the storage domain here.
update storage.buckets
set
  allowed_mime_types = array['text/csv', 'application/pdf'],
  file_size_limit = 52428800
where id = 'reports';
