-- ==================================
-- Content Taxonomy (FILM-1507)
-- ==================================
-- Controlled per-account vocabulary for tagging published content, so
-- tag-level median analytics become possible. publishes.tags remains
-- free-text platform SEO keywords and is unrelated to this taxonomy.

create table if not exists public.content_tags (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  dimension varchar(30) not null,
  slug varchar(80) not null,
  label varchar(120) not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (account_id, dimension, slug),
  check (dimension in ('topic', 'format', 'thumbnail_style', 'hook_type'))
);

comment on table public.content_tags is 'Controlled per-account taxonomy for content analysis (topic/format/thumbnail_style/hook_type)';
comment on column public.content_tags.slug is 'Stable machine key; joined into ClickHouse video_dim.tags as dimension:slug';

create index if not exists idx_content_tags_account_dimension
  on public.content_tags(account_id, dimension);

create table if not exists public.publish_tags (
  publish_id uuid not null references public.publishes(id) on delete cascade,
  tag_id uuid not null references public.content_tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (publish_id, tag_id)
);

comment on table public.publish_tags is 'Assignment of taxonomy tags to published content';

create index if not exists idx_publish_tags_tag_id on public.publish_tags(tag_id);

-- ==================================
-- RLS
-- ==================================

alter table public.content_tags enable row level security;
alter table public.publish_tags enable row level security;

revoke all on public.content_tags from authenticated, service_role;
revoke all on public.publish_tags from authenticated, service_role;

grant select, insert, update, delete on public.content_tags to authenticated;
grant select, insert, delete on public.publish_tags to authenticated;
grant select, insert, update, delete on public.content_tags to service_role;
grant select, insert, update, delete on public.publish_tags to service_role;

create policy "content_tags_read" on public.content_tags for select
  to authenticated using (public.has_account_access(account_id));

create policy "content_tags_create" on public.content_tags for insert
  to authenticated with check (public.has_account_access(account_id));

create policy "content_tags_update" on public.content_tags for update
  to authenticated using (public.has_account_access(account_id));

create policy "content_tags_delete" on public.content_tags for delete
  to authenticated using (public.has_account_access(account_id));

-- publish_tags authorize through the publish's project chain
create policy "publish_tags_read" on public.publish_tags for select
  to authenticated using (
    exists (
      select 1
      from public.publishes p
      join public.episodes e on e.id = p.episode_id
      join public.projects pr on pr.id = e.project_id
      where p.id = publish_id
        and public.has_account_access(pr.account_id)
    )
  );

create policy "publish_tags_create" on public.publish_tags for insert
  to authenticated with check (
    exists (
      select 1
      from public.publishes p
      join public.episodes e on e.id = p.episode_id
      join public.projects pr on pr.id = e.project_id
      where p.id = publish_id
        and public.has_account_access(pr.account_id)
    )
  );

create policy "publish_tags_delete" on public.publish_tags for delete
  to authenticated using (
    exists (
      select 1
      from public.publishes p
      join public.episodes e on e.id = p.episode_id
      join public.projects pr on pr.id = e.project_id
      where p.id = publish_id
        and public.has_account_access(pr.account_id)
    )
  );
