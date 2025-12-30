/*
 * -------------------------------------------------------
 * Section: Project Assets Storage Bucket
 * Creates storage bucket for project reference images
 * (character references, locations, voice avatars, cover images)
 * -------------------------------------------------------
 */

-- Create project-assets bucket (public read for images)
insert into
  storage.buckets (id, name, public)
values
  ('project-assets', 'project-assets', true)
on conflict (id) do nothing;

-- Helper function to extract project ID from storage path
-- Path format: {projectId}/{assetId}/{filename} or {projectId}/{filename}
create
or replace function kit.get_project_id_from_path (path text) returns uuid
set
  search_path = '' as $$
declare
  parts text[];
  project_id_text text;
begin
  -- Split path by '/'
  parts := string_to_array(path, '/');

  -- First part is the project ID
  if array_length(parts, 1) >= 1 then
    project_id_text := parts[1];
    -- Try to cast to UUID, return null if invalid
    begin
      return project_id_text::uuid;
    exception when invalid_text_representation then
      return null;
    end;
  end if;

  return null;
end;
$$ language plpgsql;

grant
execute on function kit.get_project_id_from_path (text) to authenticated,
service_role;

-- RLS policy for project-assets bucket: SELECT
-- Authenticated users can read any project assets (bucket is public)
create policy project_assets_select on storage.objects for select
to authenticated
using (bucket_id = 'project-assets');

-- RLS policy for project-assets bucket: INSERT
-- Authenticated users can insert to project-assets bucket
-- Project-level access is validated at the application layer
create policy project_assets_insert on storage.objects for insert
to authenticated
with check (bucket_id = 'project-assets');

-- RLS policy for project-assets bucket: UPDATE
-- User must have role on the project
create policy project_assets_update on storage.objects for update
to authenticated
using (
  bucket_id = 'project-assets'
  and public.has_role_on_project(kit.get_project_id_from_path(name))
)
with check (
  bucket_id = 'project-assets'
  and public.has_role_on_project(kit.get_project_id_from_path(name))
);

-- RLS policy for project-assets bucket: DELETE
-- User must have role on the project
create policy project_assets_delete on storage.objects for delete
to authenticated
using (
  bucket_id = 'project-assets'
  and public.has_role_on_project(kit.get_project_id_from_path(name))
);

