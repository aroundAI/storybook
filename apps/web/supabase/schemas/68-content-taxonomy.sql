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
  -- on delete set null: migration 20260919061806; the row outlives its author.
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (account_id, dimension, slug),
  -- FILM-1717 (20261001113701, 20261001121658): taxonomy, then the genome's
  -- observable and semantic attributes. The list is TAG_DIMENSIONS in
  -- genome-attributes.ts.
  constraint content_tags_dimension_check check (dimension in (
    'topic', 'format', 'thumbnail_style',
    'hook_type', 'opening_visual', 'first_sentence', 'face_present',
    'text_present', 'cuts_per_minute', 'scene_changes', 'question_first_3s',
    'result_first',
    'curiosity', 'novelty', 'utility', 'relatability', 'identity',
    'surprise', 'aspiration', 'controversy', 'humour', 'authority'
  )),
  -- Closed values for the yes/no and banded dimensions (CLOSED_TAG_VALUES).
  constraint content_tags_genome_closed_values_check check (
    case dimension
      when 'face_present' then slug in ('yes', 'no')
      when 'text_present' then slug in ('yes', 'no')
      when 'question_first_3s' then slug in ('yes', 'no')
      when 'result_first' then slug in ('yes', 'no')
      when 'cuts_per_minute' then slug in ('under-5', '5-to-15', '15-to-30', 'over-30')
      when 'scene_changes' then slug in ('none', '1-to-3', '4-to-10', 'over-10')
      when 'curiosity' then slug in ('low', 'medium', 'high')
      when 'novelty' then slug in ('low', 'medium', 'high')
      when 'utility' then slug in ('low', 'medium', 'high')
      when 'relatability' then slug in ('low', 'medium', 'high')
      when 'identity' then slug in ('low', 'medium', 'high')
      when 'surprise' then slug in ('low', 'medium', 'high')
      when 'aspiration' then slug in ('low', 'medium', 'high')
      when 'controversy' then slug in ('low', 'medium', 'high')
      when 'humour' then slug in ('low', 'medium', 'high')
      when 'authority' then slug in ('low', 'medium', 'high')
      else true
    end
  )
);

comment on table public.content_tags is 'Controlled per-account vocabulary for content analysis: taxonomy (topic/format/thumbnail_style) and genome attributes (FILM-1717)';
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
        -- KB-98: the tag must be the video's account's
        and public.tag_in_account(tag_id, pr.account_id)
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

-- ==================================
-- Tagged-library size
-- ==================================
-- Counts DISTINCT tagged publishes. A plain count of publish_tags counts
-- assignments, so eight videos with four tags each would clear a gate meant
-- to require thirty videos.

create or replace function public.count_tagged_publishes(target_account_id uuid)
returns integer
language sql
security invoker
stable
set search_path = ''
as $$
  select count(distinct pt.publish_id)::int
  from public.publish_tags pt
  join public.content_tags ct on ct.id = pt.tag_id
  where ct.account_id = target_account_id;
$$;

grant execute on function public.count_tagged_publishes(uuid) to authenticated;

-- KB-98 (20260925120329): whether a tag belongs to an account, for the
-- policies that link one. SECURITY DEFINER: an ownership fact, the same for
-- every caller, not tied to content_tags' read policy.
create or replace function public.tag_in_account(tag_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.content_tags t
     where t.id = tag_in_account.tag_id
       and t.account_id = tag_in_account.account_id
  );
$$;

revoke all on function public.tag_in_account(uuid, uuid) from public, anon;
grant execute on function public.tag_in_account(uuid, uuid) to authenticated, service_role;

-- A tag stays in its account (keep_account_id: 32-platform-connections.sql)
create trigger content_tags_keep_account
  before update of account_id on public.content_tags
  for each row execute function public.keep_account_id('tag');
