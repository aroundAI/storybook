/*
 * Audio storage buckets (KB-55). Mirror of
 * migrations/20260923075906_kb55-storage-buckets.sql; the migration is what
 * builds the database.
 *
 * On R2 these names are key prefixes in one bucket; on the Supabase provider
 * they are these buckets. MIME lists: packages/features/storage/src/buckets.ts.
 */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('audio', 'audio', true, 52428800, array['audio/mpeg']),
  ('audio-assets', 'audio-assets', true, 52428800, array['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a']);

-- audio: project writers (KB-28's rule) on `<projectId>/…` paths. Dialogue and
-- voice-preview paths name no project and are written by the service role.
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

-- audio-assets: no policy for authenticated users; only the server writes it.
