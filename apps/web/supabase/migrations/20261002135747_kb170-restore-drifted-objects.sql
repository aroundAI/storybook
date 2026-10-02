-- KB-170: three objects the migration history creates that production lacks.
--
-- Measured 2026-10-02 against the owner's structure-only dump of production
-- (public and storage), loaded beside a database built from the migrations
-- through 20260923042517, the last version production records:
--
--   external_content.chk_external_content_category
--     20260211200002 first shipped as restrict_external_sources_rls.sql and
--     reached production. The file was then deleted and its version reused
--     for add_external_content_category_check.sql, which production skips
--     as already applied. (The deleted file is also why production's
--     external_sources read policy has another name; KB-26's migration now
--     drops either.)
--   projects.ix_projects_account_slug_active
--     20260103120000 first shipped as CREATE INDEX CONCURRENTLY, which
--     cannot run inside a migration's transaction; the other three indexes
--     in that file exist in production and this one does not.
--   storage.objects project_assets_select (20251207162036)
--     Absent from production; no migration drops it. Storage needs a SELECT
--     policy to replace or delete an object, so without it owners cannot
--     overwrite or delete their own project assets
--     (project-assets-storage-rls.test.sql 34-36, 39-40 fail against
--     production's end state and pass with this).
--
-- Each is created only where missing, as its original migration created
-- it, so a database built from migrations is unchanged by this file.
-- The CHECK constraint validates existing rows: KB-170 gives the count to
-- run before deploying.

create index if not exists ix_projects_account_slug_active
  on public.projects (account_id, slug)
  where status = 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.external_content'::regclass
       and conname = 'chk_external_content_category'
  ) then
    alter table public.external_content
      add constraint chk_external_content_category check (
        category in ('news', 'research', 'encyclopedia', 'historical', 'official', 'multimedia')
      );
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'project_assets_select'
  ) then
    create policy project_assets_select on storage.objects for select
      to authenticated
      using (bucket_id = 'project-assets');
  end if;
end;
$$;
