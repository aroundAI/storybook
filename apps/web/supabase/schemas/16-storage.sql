/*
 * -------------------------------------------------------
 * Section: Storage
 * We create the schema for the storage
 * -------------------------------------------------------
 */

-- Account Image
--
-- Restored. This was commented out as "needs investigation", but the RLS
-- policy below still references the bucket, storage.test.sql inserts into
-- it, and presigned-upload.ts defaults to it — so its absence was a live
-- gap rather than a deliberate removal. The insert applies cleanly against
-- the current schema; whatever the original problem was, it does not
-- reproduce.
insert into
  storage.buckets (id, name, public)
values
  ('account_image', 'account_image', true)
on conflict (id) do nothing;

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

-- Who may write an account's picture: the account itself, or a member with
-- settings.manage. The policy and the presign route both ask this (KB-53,
-- 20260924080133_kb53-account-image-writes.sql). A name that is not
-- `<uuid>.<ext>` is refused, not an error.
create or replace function public.can_write_account_image (path text)
returns boolean
language plpgsql
stable
security definer
set search_path = '' as $$
declare
  account uuid;
begin
  begin
    account := kit.get_storage_filename_as_uuid(path);
  exception when invalid_text_representation then
    return false;
  end;

  return coalesce(
    account = auth.uid()
      or public.has_permission(auth.uid(), account, 'settings.manage'::public.app_permissions),
    false
  );
end;
$$;

revoke all on function public.can_write_account_image (text) from public, anon;
grant execute on function public.can_write_account_image (text) to authenticated, service_role;

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
  and public.can_write_account_image(name)
);

-- Limits: the image types and size the presign route admits (KB-53)
update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'account_image';