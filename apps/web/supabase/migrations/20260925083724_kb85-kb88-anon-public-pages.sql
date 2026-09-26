-- KB-85 and KB-88: public share pages for visitors who are not signed in,
-- with `anon` (the public API key) at least privilege.
--
-- Test: apps/web/supabase/tests/database/anon-public-surface.test.sql
--
-- KB-88. `anon` had no USAGE on schema public (20221215192558_schema.sql),
-- so every /@company, project and episode page was a 404 to anyone signed
-- out, and the sitemap listed none of them.
--
-- KB-85. That missing USAGE was also the only thing keeping Supabase's
-- default grants dormant: anon held SELECT, INSERT, UPDATE and DELETE on 64
-- of 86 tables, writes on two views, all four sequences, and EXECUTE on two
-- studio RPCs (measured 2026-09-25). So the grants go first, and USAGE last.
--
-- What anon reads afterwards is three owner-rights views, the KB-60 shape
-- (public_accounts): their column lists and filters are the whole exposure.
-- They list PUBLIC rows only. An unlisted project or episode ("only people
-- with the direct link") opens through a lookup by its exact key, so it can
-- be fetched but never listed.
--
-- The rules live once, in two kit views (kit is not exposed by the API):
--   kit.shareable_projects  public or unlisted project of a public team
--   kit.shareable_episodes  live episode, not private, of a shareable project
-- The public views and the lookups are filters over those two.

-- ============================================================
-- 1. KB-85: strip anon, before it can reach anything
-- ============================================================

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on function public.get_episode_languages(uuid[]) from anon;
revoke execute on function public.get_episode_audio_stats(uuid[]) from anon;

-- Objects later migrations create (as postgres) grant anon nothing.
-- supabase_admin's own defaults, and the pgvector functions it owns in
-- public, are out of this role's reach on hosted Supabase: see KB-85.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- ============================================================
-- 2. What may be shared at all
-- ============================================================

create view kit.shareable_projects
with (security_barrier = true) as
select
  p.id,
  p.account_id,
  a.slug as account_slug,
  p.name,
  p.description,
  p.public_slug,
  p.visibility,
  -- The page reads three keys. The rest of metadata is studio settings
  -- (canon, providers, platforms) and stays private.
  jsonb_strip_nulls(jsonb_build_object(
    'cover_url', p.metadata -> 'cover_url',
    'genre', p.metadata -> 'genre',
    'target_audience', p.metadata -> 'target_audience'
  )) as metadata,
  p.seo_metadata,
  p.created_at,
  p.updated_at
from public.projects p
join public.public_accounts a on a.id = p.account_id
where p.visibility in ('public', 'unlisted')
  and p.public_slug is not null;

create view kit.shareable_episodes
with (security_barrier = true) as
select
  e.id,
  e.project_id,
  p.public_slug as project_public_slug,
  p.account_slug,
  e.number,
  e.title,
  e.description,
  e.duration_seconds,
  e.thumbnail_url,
  e.slug,
  e.public_slug,
  e.visibility,
  e.localized_videos,
  e.seo_metadata,
  e.created_at,
  e.updated_at
from public.episodes e
join kit.shareable_projects p on p.id = e.project_id
where e.deleted_at is null
  and e.visibility in ('inherit', 'public', 'unlisted');

revoke all on kit.shareable_projects, kit.shareable_episodes
  from public, anon, authenticated, service_role;

-- ============================================================
-- 3. What may be listed: public rows only
-- ============================================================

create view public.public_projects
with (security_barrier = true) as
select * from kit.shareable_projects
where visibility = 'public';

create view public.public_episodes
with (security_barrier = true) as
select e.* from kit.shareable_episodes e
where e.visibility in ('public', 'inherit')
  and e.project_id in (select id from public.public_projects);

-- Simple views are automatically updatable: read only, for everyone.
revoke all on public.public_projects, public.public_episodes
  from public, anon, authenticated, service_role;
grant select on public.public_projects, public.public_episodes
  to anon, authenticated, service_role;

-- Section 1 took this back from anon along with everything else.
grant select on public.public_accounts to anon;

comment on view public.public_projects is
  'KB-85/88: public projects of public teams, the columns public pages render. Owner-rights, read only. Unlisted projects open only through get_shared_project.';
comment on view public.public_episodes is
  'KB-85/88: listable episodes of public projects, the columns public pages render. Owner-rights, read only. Unlisted episodes open only through get_shared_episode.';

-- ============================================================
-- 4. What opens by its exact link: public or unlisted
-- ============================================================
-- SECURITY DEFINER over the kit views. No caller identity is involved: the
-- access rule is the row's own visibility, applied by the kit views, and
-- the key must match exactly (equality, never a pattern).

create function public.get_shared_project(p_account_id uuid, p_public_slug text)
returns setof public.public_projects
language sql
stable
security definer
set search_path = ''
as $$
  select * from kit.shareable_projects
   where account_id = p_account_id
     and public_slug = p_public_slug;
$$;

create function public.get_shared_project_episodes(p_project_id uuid)
returns setof public.public_episodes
language sql
stable
security definer
set search_path = ''
as $$
  select * from kit.shareable_episodes
   where project_id = p_project_id
     and visibility in ('public', 'inherit');
$$;

create function public.get_shared_episode(p_project_id uuid, p_slug text)
returns setof public.public_episodes
language sql
stable
security definer
set search_path = ''
as $$
  select * from kit.shareable_episodes
   where project_id = p_project_id
     and slug = p_slug;
$$;

revoke all on function public.get_shared_project(uuid, text) from public, anon, authenticated;
revoke all on function public.get_shared_project_episodes(uuid) from public, anon, authenticated;
revoke all on function public.get_shared_episode(uuid, text) from public, anon, authenticated;
grant execute on function public.get_shared_project(uuid, text) to anon, authenticated, service_role;
grant execute on function public.get_shared_project_episodes(uuid) to anon, authenticated, service_role;
grant execute on function public.get_shared_episode(uuid, text) to anon, authenticated, service_role;

-- ============================================================
-- 5. The base tables are for members again
-- ============================================================
-- Public pages read the views above. These policies let any signed-in user
-- read every column of a public or unlisted project and its episodes,
-- soft-deleted ones included, and list the unlisted ones (#346's lead).
-- linkAsSequel could also read another account's public project through
-- them; it now finds only projects the caller is a member of.

drop policy "Allow public read of public/unlisted projects" on public.projects;
drop policy "Allow public read of public/unlisted/inherit episodes" on public.episodes;

-- ============================================================
-- 6. KB-88: last, now that there is nothing else to reach
-- ============================================================

grant usage on schema public to anon;
