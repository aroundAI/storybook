-- KB-189 / FILM-2001: a SHA-256 for every media file, recorded where the
-- file is written.
--
-- One row per storage object, keyed by (bucket, key) as the storage adapters
-- name it: a table rather than a *_sha256 column on each of the six tables
-- that hold a media URL, because the same file can be named by more than one
-- row (an audio asset and the tracks that use it) and a key is the one thing
-- every writer holds. Keys are never rewritten with other bytes in place
-- (generated media and project-assets uploads get a new key each time);
-- a rewrite records again and replaces the row.
--
-- Readers see the rows of the projects they can read, as they see the rows
-- that name the files. Nothing but the service role writes: the workers and
-- server actions hold the bytes, and a browser upload is recorded by a route
-- that checks the caller writes the key and the object's size (KB-189).

create table if not exists public.media_checksums (
  bucket text not null,
  object_key text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes bigint not null check (bytes >= 0),
  recorded_at timestamptz not null default now(),
  primary key (bucket, object_key)
);

comment on table public.media_checksums is
  'SHA-256 and size of each stored media object, recorded once at write time; read by the edit package (KB-189, FILM-2001)';

create index if not exists media_checksums_project_id_idx
  on public.media_checksums (project_id);

alter table public.media_checksums enable row level security;

revoke all on public.media_checksums from public, anon, authenticated;
grant select on public.media_checksums to authenticated;
grant select, insert, update, delete on public.media_checksums to service_role;

create policy "media_checksums_read" on public.media_checksums
  for select to authenticated
  using (exists (
    select 1 from public.projects p
    where p.id = media_checksums.project_id
      and public.has_role_on_account(p.account_id)
  ));

-- The one write path. The project is read from the key, as every project
-- storage policy reads it (kit.get_project_id_from_path), so a writer cannot
-- file a checksum under another project than the key's own. SECURITY DEFINER
-- only to reach that kit function; it is executable by the service role
-- alone, so it is no door for a signed-in user (KB-27's inventory lists
-- only those).
create or replace function public.record_media_checksum (
  p_bucket text,
  p_key text,
  p_sha256 text,
  p_bytes bigint
) returns void
language plpgsql
security definer
set search_path = '' as $$
declare
  v_project uuid := kit.get_project_id_from_path(p_key);
begin
  if v_project is null then
    raise exception 'storage key names no project: %', p_key
      using errcode = '22023';
  end if;

  insert into public.media_checksums (bucket, object_key, project_id, sha256, bytes)
  values (p_bucket, p_key, v_project, lower(p_sha256), p_bytes)
  on conflict (bucket, object_key) do update
    set project_id = excluded.project_id,
        sha256 = excluded.sha256,
        bytes = excluded.bytes,
        recorded_at = now();
end;
$$;

revoke all on function public.record_media_checksum (text, text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.record_media_checksum (text, text, text, bigint)
  to service_role;
