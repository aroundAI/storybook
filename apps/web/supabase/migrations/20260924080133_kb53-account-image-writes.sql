-- KB-53: avatar upload is broken.
--
-- The account_image policy reads an object's file name as the owning
-- account's id (kit.get_storage_filename_as_uuid). The uploader wrote
-- `<accountId>/avatar-<ts>.png`, so the cast raised instead of deciding, and
-- the presign route refused the bucket outright. Avatars are now written to
-- `<accountId>.<ext>`, and the route signs them — on R2 no policy runs, so
-- the route must apply the same rule the policy does.
--
-- 1. public.can_write_account_image(path): the policy's WITH CHECK rule as
--    one function, which the route calls and the policy now uses. A name that
--    is not `<uuid>.<ext>` is refused (false), not an error.
-- 2. The policy's WITH CHECK calls it. USING is unchanged.
-- 3. The bucket's own limits: the four image types and 10 MB, the same the
--    route admits (UPLOAD_CONSTRAINTS.image; bound by
--    apps/web/app/api/storage/presign/__tests__/account-image-bucket.test.ts).
--    On Supabase an upload URL binds neither.

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

drop policy if exists account_image on storage.objects;

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

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'account_image';
