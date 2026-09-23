/*
 * KB-28: only a project's writers may write into its storage folder.
 *
 * Before this migration `project_assets_insert` checked the bucket name and
 * nothing else, so any signed-in user could plant an object under any
 * project's path. `project_assets_update` and `_delete` did check a role, but
 * resolved the project from the path's first segment, which is the literal
 * `projects` or `episodes` for every path the app writes. The owner's own
 * replace was refused, and their delete matched nothing and reported success.
 *
 * This migration adds one rule, "may write to this project", and builds the
 * storage policies and the presign route's check on it. Tests:
 * tests/database/project-assets-storage-rls.test.sql.
 */

-- ------------------------------------------------------------------
-- The project-write rule
-- ------------------------------------------------------------------
-- Owner, admin or member in project_members. A viewer, or a user who can
-- only see the project because it is public or unlisted, may not write.
-- Other tickets (KB-26) build on this function: change its meaning only
-- together with theirs.
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

-- ------------------------------------------------------------------
-- Which project a project-assets object belongs to
-- ------------------------------------------------------------------
-- The live path shapes:
--   <projectId>/...                 (FILM-203 and the original cover upload)
--   projects/<projectId>/...        (covers, assets, shot frames and videos, exports)
--   episodes/<episodeId>/...        (thumbnails, publish videos) -> episodes.project_id
-- Anything else resolves to null, and a null project has no writers.
-- SECURITY DEFINER so the episode lookup does not depend on the caller's
-- read access to episodes. It returns only an id.
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

-- ------------------------------------------------------------------
-- project-assets policies: every write verb uses the one rule
-- ------------------------------------------------------------------
-- SELECT is unchanged: the bucket is public.
drop policy if exists project_assets_insert on storage.objects;
drop policy if exists project_assets_update on storage.objects;
drop policy if exists project_assets_delete on storage.objects;

create policy project_assets_insert on storage.objects for insert
to authenticated
with check (
  bucket_id = 'project-assets'
  and public.can_write_project_storage(name)
);

-- WITH CHECK as well as USING, so an object cannot be moved into a project
-- the caller does not write to.
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

-- ------------------------------------------------------------------
-- project-assets bucket limits
-- ------------------------------------------------------------------
-- The types are UPLOAD_CONSTRAINTS in packages/features/assets/src/lib/
-- upload-validation.ts, which is bound to this list by
-- packages/features/assets/__tests__/allowed-types.test.ts. The size limit is
-- the largest category there (video, 500 MB). The limits apply to new
-- uploads only.
update storage.buckets
set
  file_size_limit = 524288000,
  allowed_mime_types = array[
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
where id = 'project-assets';

-- ------------------------------------------------------------------
-- Cover image: only a project's editors may change it
-- ------------------------------------------------------------------
-- SECURITY DEFINER to avoid the projects policy chain, and it used to have
-- no caller check at all, so any signed-in user could repoint any project's
-- cover. The rule is projects_update's (can_edit_project: owner or admin).
create or replace function public.update_project_cover_image (
  p_project_id uuid,
  p_cover_image_url text
)
returns void
language plpgsql
security definer
set search_path = '' as $$
begin
  if not public.can_edit_project(p_project_id) then
    raise exception 'not allowed to change this project''s cover'
      using errcode = '42501';
  end if;

  update public.projects
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('coverImageUrl', p_cover_image_url),
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.update_project_cover_image (uuid, text) from public, anon;
grant execute on function public.update_project_cover_image (uuid, text) to authenticated;
