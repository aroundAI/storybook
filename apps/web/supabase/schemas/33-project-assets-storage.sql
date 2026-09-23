/*
 * -------------------------------------------------------
 * Section: Project Assets Storage Bucket
 * Storage for project files: covers, character/location references, shot
 * frames and videos, episode thumbnails, master assets and exports.
 *
 * Mirrors migrations 20251207162036_project-assets-bucket.sql and
 * 20260923042517_kb28-project-write-scope.sql. The database is built from
 * migrations/; this file is documentation.
 * -------------------------------------------------------
 */

-- Public bucket: objects are readable by URL. Writes are limited to the
-- UPLOAD_CONSTRAINTS types and the largest of its size limits (500 MB).
insert into
  storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'project-assets',
    'project-assets',
    true,
    524288000,
    array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
      'audio/ogg',
      'audio/mp4'
    ]
  );

-- The project-write rule: owner, admin or member in project_members.
-- A viewer, or someone who can only see a public project, may not write.
create or replace function public.can_write_project (target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.can_write_project (uuid) from public, anon;
grant execute on function public.can_write_project (uuid) to authenticated, service_role;

-- Which project an object belongs to:
--   <projectId>/...            -> projectId
--   projects/<projectId>/...   -> projectId
--   episodes/<episodeId>/...   -> episodes.project_id
--   anything else              -> null (no writers)
create or replace function kit.get_project_id_from_path (path text)
returns uuid
language plpgsql
stable
security definer
set search_path = '' as $$
declare
  parts text[] := string_to_array(path, '/');
  resolved uuid;
begin
  if coalesce(array_length(parts, 1), 0) < 2 then
    return null;
  end if;

  begin
    if parts[1] = 'projects' then
      return parts[2]::uuid;
    end if;

    if parts[1] = 'episodes' then
      select e.project_id into resolved
      from public.episodes e
      where e.id = parts[2]::uuid;

      return resolved;
    end if;

    return parts[1]::uuid;
  exception when invalid_text_representation then
    return null;
  end;
end;
$$;

grant execute on function kit.get_project_id_from_path (text) to authenticated, service_role;

create or replace function public.can_write_project_storage (path text)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  select public.can_write_project(kit.get_project_id_from_path(path));
$$;

revoke all on function public.can_write_project_storage (text) from public, anon;
grant execute on function public.can_write_project_storage (text) to authenticated, service_role;

create policy project_assets_select on storage.objects for select
to authenticated
using (bucket_id = 'project-assets');

create policy project_assets_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and public.can_write_project_storage(name)
);

create policy project_assets_update on storage.objects for update
to authenticated
using (
  bucket_id = 'project-assets'
  and public.can_write_project_storage(name)
)
with check (
  bucket_id = 'project-assets'
  and public.can_write_project_storage(name)
);

create policy project_assets_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-assets'
  and public.can_write_project_storage(name)
);
