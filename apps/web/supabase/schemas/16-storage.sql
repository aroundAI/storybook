/*
 * -------------------------------------------------------
 * Section: Storage
 * We create the schema for the storage
 * -------------------------------------------------------
 */

-- Account Image
insert into
  storage.buckets (id, name, PUBLIC)
values
  ('account_image', 'account_image', true);

-- Function: get the storage filename as a UUID.
-- Useful if you want to name files with UUIDs related to an account
create
or replace function kit.get_storage_filename_as_uuid (name text) returns uuid
set
  search_path = '' as $$
begin
    return replace(storage.filename(name), concat('.',
	storage.extension(name)), '')::uuid;

end;

$$ language plpgsql;

grant
execute on function kit.get_storage_filename_as_uuid (text) to authenticated,
service_role;

-- RLS policies for storage bucket account_image
create policy account_image on storage.objects for all using (
  bucket_id = 'account_image'
  and (
    kit.get_storage_filename_as_uuid(name) = auth.uid()
    or public.has_role_on_account(kit.get_storage_filename_as_uuid(name))
  )
)
with check (
  bucket_id = 'account_image'
  and (
    kit.get_storage_filename_as_uuid(name) = auth.uid()
    or public.has_permission(
      auth.uid(),
      kit.get_storage_filename_as_uuid(name),
      'settings.manage'
    )
  )
);