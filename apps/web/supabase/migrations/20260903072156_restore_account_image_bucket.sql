-- Restore the account_image storage bucket.
--
-- Its creation was commented out in schemas/16-storage.sql as "temporarily
-- ... needs investigation", but the RLS policy referencing it was left in
-- place, storage.test.sql inserts objects into it, and
-- packages/features/storage/src/client/presigned-upload.ts takes it as the
-- default bucket. So account image uploads had nowhere to go.
--
-- The insert applies cleanly against the current schema.

insert into storage.buckets (id, name, public)
values ('account_image', 'account_image', true)
on conflict (id) do nothing;
