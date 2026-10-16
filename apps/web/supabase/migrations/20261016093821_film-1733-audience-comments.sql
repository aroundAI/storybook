-- FILM-1733. What the audience says about each video, and how that changes.
--
-- Until now only comment counts were synced. audience_comments holds the
-- text of the comments on the team's own published videos, with no author
-- name or id; comment_labels holds what each comment is about and its
-- tone, written by the server's model or by the team's own AI through the
-- MCP connector; audience_comment_syncs records where each video's sync
-- reached.
--
-- YouTube's Developer Policies allow stored API data for 30 days unless it
-- is refreshed (III.E.4.c): fetched_at is the refresh, and the comment
-- sync deletes a YouTube comment not refreshed for 30 days.

create table public.audience_comments (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform_connection_id uuid not null,
  publish_id uuid not null references public.publishes(id) on delete cascade,
  platform text not null
    check (platform in ('youtube', 'instagram', 'facebook')),
  -- The platform's id for the comment; a reply carries its thread's
  platform_comment_id text not null check (length(platform_comment_id) between 1 and 255),
  parent_platform_comment_id text
    check (parent_platform_comment_id is null
       or length(parent_platform_comment_id) between 1 and 255),
  text text not null check (length(text) <= 10000),
  like_count integer not null default 0 check (like_count >= 0),
  -- Null: the platform does not report it (Instagram, read top-level only)
  reply_count integer check (reply_count is null or reply_count >= 0),
  commented_at timestamptz not null,
  -- When the platform last returned it: the 30-day clock for YouTube
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint audience_comments_platform_comment_key
    unique (platform, platform_comment_id),
  -- comment_labels names a comment with its account
  constraint audience_comments_id_account_key unique (id, account_id),
  constraint audience_comments_connection_account_fkey
    foreign key (platform_connection_id, account_id)
    references public.platform_connections (id, account_id)
    on delete cascade
);

comment on table public.audience_comments is
  'The text of comments on the team''s own published videos, without author name or id. Written by the comment sync (service role) only. YouTube rows not refreshed for 30 days are deleted (Developer Policies III.E.4.c). FILM-1733';
comment on column public.audience_comments.fetched_at is
  'When the platform last returned this comment. A YouTube comment not refreshed for 30 days is deleted. FILM-1733';

create index idx_audience_comments_publish
  on public.audience_comments (publish_id, commented_at);
create index idx_audience_comments_account
  on public.audience_comments (account_id, commented_at desc);
create index idx_audience_comments_connection
  on public.audience_comments (platform_connection_id);
create index idx_audience_comments_fetched
  on public.audience_comments (platform, fetched_at);

alter table public.audience_comments enable row level security;

revoke all on public.audience_comments from anon, authenticated, service_role;
grant select on public.audience_comments to authenticated;
grant select, insert, update, delete on public.audience_comments to service_role;

-- The team reads its comments; only the sync writes them
create policy audience_comments_read on public.audience_comments
  for select to authenticated
  using (public.has_account_access(account_id));

-- KB-99: a workspace table belongs to a team account
create trigger require_team_account
  before insert or update of account_id on public.audience_comments
  for each row execute function kit.require_team_account();

-- ----------------------------------------------------------------------
-- comment_labels: what a comment is about, and its tone
-- ----------------------------------------------------------------------
create table public.comment_labels (
  comment_id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  sentiment text not null
    check (sentiment in ('positive', 'neutral', 'negative')),
  topics text[] not null default '{}'
    check (cardinality(topics) <= 9
       and topics <@ array[
         'story', 'character', 'voice_audio', 'visuals', 'feels_ai',
         'pacing', 'wants_more', 'question', 'spam'
       ]::text[]),
  -- Who labelled it: the server's model, or a team's AI over MCP
  source text not null check (source in ('server', 'mcp')),
  -- The model as its labeller named it, and the prompt's version
  model text not null check (length(model) between 1 and 200),
  prompt_version text not null check (length(prompt_version) between 1 and 50),
  mcp_connection_id uuid references public.mcp_connections(id) on delete set null,
  labelled_at timestamptz not null default now(),
  constraint comment_labels_comment_account_fkey
    foreign key (comment_id, account_id)
    references public.audience_comments (id, account_id)
    on delete cascade
);

comment on table public.comment_labels is
  'One label per comment: its tone and what it is about, from a closed list. Written by the server''s model (service role) or by the team''s AI through the MCP connector (source mcp). Deleted with its comment. FILM-1733';

create index idx_comment_labels_account on public.comment_labels (account_id);

alter table public.comment_labels enable row level security;

revoke all on public.comment_labels from anon, authenticated, service_role;
grant select, insert, update, delete on public.comment_labels to authenticated;
grant select, insert, update, delete on public.comment_labels to service_role;

-- The team reads and writes its labels: the MCP connector writes them on
-- the person's own client
create policy comment_labels_read on public.comment_labels
  for select to authenticated
  using (public.has_account_access(account_id));

create policy comment_labels_insert on public.comment_labels
  for insert to authenticated
  with check (public.has_account_access(account_id));

create policy comment_labels_update on public.comment_labels
  for update to authenticated
  using (public.has_account_access(account_id))
  with check (public.has_account_access(account_id));

create policy comment_labels_delete on public.comment_labels
  for delete to authenticated
  using (public.has_account_access(account_id));

create trigger require_team_account
  before insert or update of account_id on public.comment_labels
  for each row execute function kit.require_team_account();

-- ----------------------------------------------------------------------
-- audience_comment_syncs: where each video's comment sync reached
-- ----------------------------------------------------------------------
create table public.audience_comment_syncs (
  publish_id uuid primary key references public.publishes(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  last_synced_at timestamptz,
  -- The last time every comment was read again, not only new ones
  last_refreshed_at timestamptz,
  last_status text not null default 'never'
    check (last_status in ('never', 'ok', 'failed', 'not_authorised', 'unsupported')),
  last_error text check (last_error is null or length(last_error) <= 1000),
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.audience_comment_syncs is
  'Where each published video''s comment sync reached, and why it stopped. Written by the comment sync (service role). FILM-1733';

create index idx_audience_comment_syncs_account
  on public.audience_comment_syncs (account_id);

alter table public.audience_comment_syncs enable row level security;

revoke all on public.audience_comment_syncs from anon, authenticated, service_role;
grant select on public.audience_comment_syncs to authenticated;
grant select, insert, update, delete on public.audience_comment_syncs to service_role;

create policy audience_comment_syncs_read on public.audience_comment_syncs
  for select to authenticated
  using (public.has_account_access(account_id));

create trigger require_team_account
  before insert or update of account_id on public.audience_comment_syncs
  for each row execute function kit.require_team_account();

-- ----------------------------------------------------------------------
-- The server's labelling runs on the generation core like the other
-- server-only model calls
-- ----------------------------------------------------------------------
alter table public.generation_runs drop constraint generation_runs_stage_check;
alter table public.generation_runs add constraint generation_runs_stage_check
  check (stage in (
    'season_outline', 'season_analysis', 'ideation', 'story',
    'story_refinement', 'screenplay', 'screenplay_refinement', 'shots',
    'audio_cues', 'dialogue_translation', 'asset_description',
    'fact_extraction', 'episode_summary', 'publish_metadata',
    -- server-only model calls with no content stage, and the audio render
    -- job: they have a run so the worker can load them, never a brief
    'analytics_insights', 'language_insights', 'fact_check', 'audio_render',
    'comment_labels'
  ));

comment on column public.generation_runs.stage is
  'The FILM-1901 registry key, or one of the server-only keys analytics_insights, language_insights, fact_check, audio_render and comment_labels, which no StageDefinition serves';

-- ----------------------------------------------------------------------
-- A purged connection's comments go with its other vendor data (KB-20,
-- KB-22): YouTube's within 7 days of an in-app disconnect. The labels
-- cascade with their comments.
-- ----------------------------------------------------------------------
create or replace function public.purge_connection_vendor_rows(
  p_connection_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_revenue integer;
  v_report_jobs integer;
  v_publishes integer;
  v_comments integer;
  v_comment_syncs integer;
begin
  delete from public.revenue_records r
   using public.publishes p
   where p.id = r.publish_id
     and p.platform_connection_id = p_connection_id
     and r.source = 'api';
  get diagnostics v_revenue = row_count;

  delete from public.youtube_report_jobs
   where platform_connection_id = p_connection_id;
  get diagnostics v_report_jobs = row_count;

  update public.publishes
     set metadata = coalesce(metadata, '{}'::jsonb) - 'sync',
         duration_seconds = null
   where platform_connection_id = p_connection_id
     and (metadata ? 'sync' or duration_seconds is not null);
  get diagnostics v_publishes = row_count;

  delete from public.audience_comments
   where platform_connection_id = p_connection_id;
  get diagnostics v_comments = row_count;

  delete from public.audience_comment_syncs s
   using public.publishes p
   where p.id = s.publish_id
     and p.platform_connection_id = p_connection_id;
  get diagnostics v_comment_syncs = row_count;

  update public.platform_connections
     set metadata = coalesce(metadata, '{}'::jsonb)
       - 'thumbnail_url' - 'avatar_url' - 'profile_image_url'
       - 'profile_picture_url' - 'picture' - 'picture_url'
       - 'followers_count'
   where id = p_connection_id;

  return jsonb_build_object(
    'revenue_records_api', v_revenue,
    'youtube_report_jobs', v_report_jobs,
    'publishes_reset', v_publishes,
    'audience_comments', v_comments,
    'audience_comment_syncs', v_comment_syncs
  );
end;
$$;

revoke all on function public.purge_connection_vendor_rows(uuid) from public, anon, authenticated;
grant execute on function public.purge_connection_vendor_rows(uuid) to service_role;

-- ----------------------------------------------------------------------
-- Comments with no label yet: what the labelling run and the MCP tool read
-- ----------------------------------------------------------------------
-- Security invoker: a person sees only their teams' comments (RLS); the
-- service role sees every team's.
create or replace function public.unlabelled_audience_comments(
  p_account_id uuid,
  p_publish_ids uuid[] default null,
  p_limit integer default 200
)
returns setof public.audience_comments
language sql
stable
security invoker
set search_path = ''
as $$
  select c.*
    from public.audience_comments c
   where c.account_id = p_account_id
     and (p_publish_ids is null or c.publish_id = any (p_publish_ids))
     and not exists (
       select 1 from public.comment_labels l where l.comment_id = c.id
     )
   order by c.commented_at, c.id
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

comment on function public.unlabelled_audience_comments(uuid, uuid[], integer) is
  'A team''s comments with no label, oldest first, at most 500. Security invoker: RLS decides whose. FILM-1733';

revoke all on function public.unlabelled_audience_comments(uuid, uuid[], integer) from public, anon;
grant execute on function public.unlabelled_audience_comments(uuid, uuid[], integer) to authenticated, service_role;

-- The projects the hourly sync hands to the server's labelling run: one
-- run per project, so the worker checks its user may write that project
create or replace function public.projects_with_unlabelled_comments()
returns table (account_id uuid, project_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select distinct c.account_id, e.project_id
    from public.audience_comments c
    join public.publishes p on p.id = c.publish_id
    join public.episodes e on e.id = p.episode_id
   where not exists (
     select 1 from public.comment_labels l where l.comment_id = c.id
   );
$$;

revoke all on function public.projects_with_unlabelled_comments() from public, anon, authenticated;
grant execute on function public.projects_with_unlabelled_comments() to service_role;
