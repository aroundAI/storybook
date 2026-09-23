-- KB-26: uploaded research sources were readable by every signed-in user.
--
-- `external_content` held the shared provider cache *and* every upload, with
-- no owner column and a `using (true)` read policy; `external_sources` was
-- keyed by slug alone, so two tenants uploading the same name shared (and
-- overwrote) one row, and an upload named "Reuters" rewrote the seeded one.
--
-- After this migration:
--   * an upload belongs to a project (`project_id`) and is marked `is_upload`;
--   * an upload is readable only by the project's owner/admin/member rows in
--     `project_members` (`public.can_write_project`, from KB-28). Project
--     visibility never grants access: public/unlisted projects are readable
--     by everyone (20260108120000_public_sharing_rls.sql:28);
--   * a shared cache row (`is_upload = false`) stays readable by every
--     signed-in user;
--   * an upload with no project, which is every pre-fix upload, since their
--     owner was never recorded, is readable by nobody until the owner
--     reattaches it (runbook in the KB-26 PR);
--   * source slugs are unique per project; shared sources (project_id null)
--     stay unique by slug among themselves. A future seed must use
--     `on conflict (project_id, slug)`, not `(slug)`.

do $$
begin
  if current_setting('server_version_num')::int < 150000 then
    raise exception
      'KB-26 needs Postgres 15 or later: `unique nulls not distinct` does not exist on %',
      current_setting('server_version');
  end if;
end
$$;

-- =============================================================================
-- external_content
-- =============================================================================

alter table public.external_content
  add column project_id uuid references public.projects (id) on delete cascade,
  add column is_upload boolean not null default false;

-- Only uploadSourceContentAction writes 'manual-' ids; providers use
-- 'newsapi:', 'ss:' and 'archive:'. Marked, not deleted.
update public.external_content
set is_upload = true
where external_id like 'manual-%';

alter table public.external_content
  add constraint external_content_owned_is_upload
  check (project_id is null or is_upload);

create index idx_external_content_project
  on public.external_content (project_id)
  where project_id is not null;

drop policy "Authenticated users can view content" on public.external_content;

create policy external_content_read on public.external_content
  for select to authenticated
  using (
    not is_upload
    or (project_id is not null and public.can_write_project(project_id))
  );

comment on column public.external_content.project_id is
  'KB-26: the project an upload belongs to. Null for shared provider cache rows and for pre-fix uploads awaiting reattachment.';
comment on column public.external_content.is_upload is
  'KB-26: true for user uploads. An upload is readable only by owner/admin/member of its project; with no project, by nobody.';

-- =============================================================================
-- external_sources
-- =============================================================================

alter table public.external_sources
  add column project_id uuid references public.projects (id) on delete cascade;

alter table public.external_sources
  drop constraint external_sources_slug_key;

alter table public.external_sources
  add constraint external_sources_project_slug_key
  unique nulls not distinct (project_id, slug);

create index idx_external_sources_project
  on public.external_sources (project_id)
  where project_id is not null;

drop policy "Anyone can view active sources" on public.external_sources;

create policy external_sources_read on public.external_sources
  for select to authenticated
  using (
    is_active
    and (project_id is null or public.can_write_project(project_id))
  );

comment on column public.external_sources.project_id is
  'KB-26: set for a source created by an upload; null for the shared registry.';
