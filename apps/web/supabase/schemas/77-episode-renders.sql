-- ==================================
-- Episode renders and deliver_edit (FILM-2003)
-- ==================================
-- Mirrors migrations/20261004162108_film-2003-episode-renders.sql.
-- Schema files are documentation; the database is built from migrations/.
--
-- StorybookStudio sends a finished cut back as renders (one row per preset
-- and language) plus one delivery. The Studio uploads each file straight to
-- storage through a presigned PUT (request_render_upload), confirms it
-- (finalize_render), then delivers (deliver_edit), which in one transaction
-- makes the primary render the episode's video, supersedes the episode's
-- older renders, ends the edit session as delivered and moves the episode
-- to ready for the existing publish flow.
--
-- * episode_renders: the session's user inserts a row in status uploading
--   for a key it names (projects/{project}/episodes/{episode}/renders/{id}.mp4)
--   and updates it to ready or failed while it is uploading; only the columns
--   finalize writes are updatable. Project members read.
-- * public.deliver_edit: SECURITY DEFINER, the one path to ready.
-- * public.expire_stale_render_uploads: the hourly cron fails renders left
--   uploading for 24 hours.

-- ----------------------------------------------------------------------
-- episode_renders
-- ----------------------------------------------------------------------
create table public.episode_renders (
  id uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  edit_session_id uuid references public.edit_sessions(id) on delete set null,
  preset text not null check (preset in (
    'youtube_16x9', 'shorts_9x16', 'tiktok_9x16', 'reels_9x16', 'square_1x1', 'master'
  )),
  language text not null default 'en'
    check (language ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$'),
  aspect text not null check (aspect in ('16:9', '9:16', '1:1')),
  file_url text,
  -- the storage key in project-assets; always this render's own key
  file_path text not null,
  file_size_bytes bigint check (file_size_bytes > 0),
  duration_seconds numeric check (duration_seconds > 0),
  thumbnail_url text,
  captions_url text,
  qa jsonb not null default '{}'::jsonb check (jsonb_typeof(qa) = 'object'),
  status text not null default 'uploading'
    check (status in ('uploading', 'ready', 'failed', 'superseded')),
  -- why a render failed: the object was missing or the wrong size, or it
  -- was never finalized
  failure_reason text check (char_length(failure_reason) <= 500),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  -- each preset renders its own frame; the master may be any
  constraint episode_renders_preset_aspect check (
    preset = 'master'
    or (preset = 'youtube_16x9' and aspect = '16:9')
    or (preset in ('shorts_9x16', 'tiktok_9x16', 'reels_9x16') and aspect = '9:16')
    or (preset = 'square_1x1' and aspect = '1:1')
  ),
  constraint episode_renders_own_key check (
    file_path like 'projects/%/episodes/' || episode_id || '/renders/' || id || '.mp4'
  ),
  -- a ready render (and a superseded one, which was ready) has its file
  constraint episode_renders_ready_has_file check (
    status not in ('ready', 'superseded')
    or (file_url is not null and file_size_bytes is not null and duration_seconds is not null)
  ),
  constraint episode_renders_failed_has_reason check (
    status <> 'failed' or failure_reason is not null
  )
);

comment on table public.episode_renders is
  'Renders StorybookStudio delivered for an episode, one per preset and language (FILM-2003)';
comment on column public.episode_renders.qa is
  'QaResultSchema of @kit/desktop-integration: {pass, issues[{type, severity, timeRange, scene, detail, repairIntent?}]}';

create index episode_renders_episode_status_idx
  on public.episode_renders (episode_id, status);

create index episode_renders_session_idx
  on public.episode_renders (edit_session_id);

create index episode_renders_created_by_idx
  on public.episode_renders (created_by);

create index episode_renders_uploading_idx
  on public.episode_renders (created_at)
  where status = 'uploading';

-- ----------------------------------------------------------------------
-- RLS: project members read; the session's user writes while it uploads
-- ----------------------------------------------------------------------
alter table public.episode_renders enable row level security;

revoke all on public.episode_renders from public, anon, authenticated;
grant select on public.episode_renders to authenticated;
grant insert (id, episode_id, edit_session_id, preset, language, aspect, file_path, file_size_bytes, created_by)
  on public.episode_renders to authenticated;
grant update (status, file_url, file_size_bytes, duration_seconds, thumbnail_url, captions_url, qa, failure_reason)
  on public.episode_renders to authenticated;
grant select, insert, update, delete on public.episode_renders to service_role;

create policy episode_renders_read on public.episode_renders
  for select to authenticated
  using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_renders.episode_id
        and public.has_role_on_project(e.project_id)
    )
  );

-- The caller's own open session on this episode, as a project
-- owner/admin/member, for the key that belongs to the row
create policy episode_renders_insert on public.episode_renders
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and status = 'uploading'
    and exists (
      select 1
      from public.edit_sessions s
      join public.episodes e on e.id = s.episode_id
      where s.id = episode_renders.edit_session_id
        and s.episode_id = episode_renders.episode_id
        and s.user_id = (select auth.uid())
        and s.status = 'open'
        and e.deleted_at is null
        and public.has_role_on_project(e.project_id)
        and not public.has_role_on_project(e.project_id, 'viewer')
        and episode_renders.file_path =
          'projects/' || e.project_id || '/episodes/' || e.id || '/renders/' || episode_renders.id || '.mp4'
    )
  );

-- Finalize: only while uploading, only to ready or failed, only by the
-- render's creator while their session is open
create policy episode_renders_finalize on public.episode_renders
  for update to authenticated
  using (
    created_by = (select auth.uid())
    and status = 'uploading'
    and exists (
      select 1
      from public.edit_sessions s
      join public.episodes e on e.id = s.episode_id
      where s.id = episode_renders.edit_session_id
        and s.user_id = (select auth.uid())
        and s.status = 'open'
        and public.has_role_on_project(e.project_id)
        and not public.has_role_on_project(e.project_id, 'viewer')
    )
  )
  with check (
    created_by = (select auth.uid())
    and status in ('uploading', 'ready', 'failed')
  );

-- ----------------------------------------------------------------------
-- deliver_edit: the one transaction that makes the episode ready
-- ----------------------------------------------------------------------
-- p_renders is [{renderId, primary?}] (DeliveryPackageSchema, validated by
-- the tool first); p_report the ExplainWhyReport; p_qa the delivery's QA
-- result; p_summary the session summary the tool computed (summarizeEditSession
-- over the events, with the report's figures), stored with the report and QA.
--
-- Returns {ok: true, ...} or {ok: false, code}: NOT_FOUND (no such session
-- the caller can see), FORBIDDEN (a viewer; not the session's user; a
-- published episode and the caller is not a project owner or admin),
-- VALIDATION_FAILED (session not open; renders not exactly one primary,
-- not this episode's, not the caller's or not ready), TARGET_CHANGED
-- (episodes.version is not p_episode_version: the content changed in
-- StoryBook during the edit; currentVersion says what it is now).
--
-- On success: an assets row (type master_video) for the primary render;
-- episodes.final_video_url and master_video_asset_id from it; the primary's
-- language slot in localized_videos set to it when empty or holding a
-- superseded render (a manual upload is kept); every other ready render of
-- the episode superseded; the session delivered with the summary through
-- kit.end_edit_session (which stamps edit_state); status ready. Every
-- episodes update bumps episodes.version (the existing trigger).
create or replace function public.deliver_edit(
  p_session_id uuid,
  p_episode_version integer,
  p_renders jsonb,
  p_report jsonb,
  p_qa jsonb,
  p_summary jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.edit_sessions;
  v_episode public.episodes;
  v_role public.project_role;
  v_ids uuid[];
  v_primary_id uuid;
  v_primaries integer;
  v_unready jsonb;
  v_primary public.episode_renders;
  v_asset_id uuid;
  v_superseded integer;
  v_localized jsonb;
  v_slot text;
begin
  if v_uid is null then
    raise exception 'refused: deliver_edit needs a signed-in user'
      using errcode = 'insufficient_privilege';
  end if;

  select s.* into v_session from public.edit_sessions s where s.id = p_session_id;

  if v_session.id is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  -- the episode first, then the session: the order kit.end_edit_session uses
  select * into v_episode from public.episodes e where e.id = v_session.episode_id for update;

  select pm.role into v_role
  from public.project_members pm
  where pm.project_id = v_episode.project_id and pm.user_id = v_uid;

  if v_episode.deleted_at is not null or v_role is null then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_role = 'viewer' then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'role', 'viewer');
  end if;

  if v_session.user_id <> v_uid then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'role', v_role::text,
      'reason', 'session');
  end if;

  select s.* into v_session from public.edit_sessions s where s.id = p_session_id for update;

  if v_session.status <> 'open' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'session',
      'status', v_session.status);
  end if;

  -- README open question 5: a delivery on a published episode supersedes
  -- the live renders, which only a project owner or admin may do
  if (v_session.previous_status = 'published' or v_episode.status = 'published')
    and v_role not in ('owner', 'admin') then
    return jsonb_build_object('ok', false, 'code', 'FORBIDDEN', 'role', v_role::text,
      'reason', 'published');
  end if;

  if p_episode_version is distinct from v_episode.version then
    return jsonb_build_object('ok', false, 'code', 'TARGET_CHANGED',
      'currentVersion', v_episode.version, 'expectedVersion', p_episode_version);
  end if;

  if jsonb_typeof(p_renders) <> 'array'
    or jsonb_array_length(p_renders) not between 1 and 20
    or exists (
      select 1 from jsonb_array_elements(p_renders) r
      where jsonb_typeof(r) <> 'object'
        or coalesce(r->>'renderId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (r ? 'primary' and jsonb_typeof(r->'primary') <> 'boolean')
    ) then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'renders');
  end if;

  select
    array_agg((r->>'renderId')::uuid),
    count(*) filter (where (r->>'primary')::boolean),
    (array_agg((r->>'renderId')::uuid) filter (where (r->>'primary')::boolean))[1]
  into v_ids, v_primaries, v_primary_id
  from jsonb_array_elements(p_renders) r;

  if v_primaries <> 1 or cardinality(v_ids) <> (select count(distinct x) from unnest(v_ids) x) then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'primary',
      'primaries', v_primaries);
  end if;

  if jsonb_typeof(p_report) <> 'object' or jsonb_typeof(p_qa) <> 'object'
    or jsonb_typeof(coalesce(p_summary, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'report');
  end if;

  -- every listed render: this episode's, the caller's, ready (locked so a
  -- concurrent delivery cannot supersede it under us)
  perform 1 from public.episode_renders r where r.id = any(v_ids) for update;

  select coalesce(jsonb_agg(jsonb_build_object(
    'renderId', x.id,
    'status', coalesce(r.status, 'missing')
  )), '[]'::jsonb)
  into v_unready
  from unnest(v_ids) as x(id)
  left join public.episode_renders r
    on r.id = x.id and r.episode_id = v_episode.id and r.created_by = v_uid
  where r.id is null or r.status <> 'ready';

  if jsonb_array_length(v_unready) > 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_FAILED', 'reason', 'not_ready',
      'renders', v_unready);
  end if;

  select * into v_primary from public.episode_renders r where r.id = v_primary_id;

  insert into public.assets (
    project_id, episode_id, name, type, file_url, file_size_bytes, content_type, metadata
  ) values (
    v_episode.project_id,
    v_episode.id,
    format('Studio render %s %s %s', v_primary.preset, v_primary.language, v_primary.id),
    'master_video',
    v_primary.file_url,
    v_primary.file_size_bytes,
    'video/mp4',
    jsonb_build_object(
      'source', 'storybookstudio',
      'renderId', v_primary.id,
      'editSessionId', p_session_id,
      'preset', v_primary.preset,
      'language', v_primary.language,
      'durationSeconds', v_primary.duration_seconds
    )
  )
  returning id into v_asset_id;

  update public.episode_renders r
  set status = 'superseded'
  where r.episode_id = v_episode.id
    and r.status = 'ready'
    and not (r.id = any(v_ids));

  get diagnostics v_superseded = row_count;

  perform kit.end_edit_session(
    p_session_id,
    'delivered',
    coalesce(p_summary, '{}'::jsonb) || jsonb_build_object(
      'report', p_report,
      'qa', p_qa,
      'renders', p_renders,
      'primaryRenderId', v_primary.id
    ),
    'delivered'
  );

  -- the primary is the default publish target for its language, unless the
  -- slot holds a file someone chose that this delivery did not supersede
  select coalesce(e.localized_videos, '{}'::jsonb) into v_localized
  from public.episodes e where e.id = v_episode.id;

  v_slot := nullif(v_localized->>v_primary.language, '');

  if v_slot is null or exists (
    select 1 from public.episode_renders r
    where r.episode_id = v_episode.id and r.status = 'superseded' and r.file_url = v_slot
  ) then
    v_localized := v_localized || jsonb_build_object(v_primary.language, v_primary.file_url);
  end if;

  update public.episodes
  set status = 'ready',
      final_video_url = v_primary.file_url,
      master_video_asset_id = v_asset_id,
      localized_videos = v_localized
  where id = v_episode.id
  returning * into v_episode;

  return jsonb_build_object(
    'ok', true,
    'episodeId', v_episode.id,
    'episodeStatus', v_episode.status,
    'episodeVersion', v_episode.version,
    'finalVideoUrl', v_episode.final_video_url,
    'masterVideoAssetId', v_asset_id,
    'primaryRenderId', v_primary.id,
    'renderIds', to_jsonb(v_ids),
    'superseded', v_superseded,
    'sessionId', p_session_id
  );
end;
$$;

revoke all on function public.deliver_edit(uuid, integer, jsonb, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.deliver_edit(uuid, integer, jsonb, jsonb, jsonb, jsonb) to authenticated, service_role;

-- ----------------------------------------------------------------------
-- expire_stale_render_uploads: the hourly cron
-- ----------------------------------------------------------------------
-- A render left uploading for 24 hours was never finalized: the Studio
-- crashed, lost its network or gave up. It fails with a reason, so the edit
-- record shows it and deliver_edit refuses it. Service role only.
create or replace function public.expire_stale_render_uploads()
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.episode_renders
  set status = 'failed',
      failure_reason = 'The upload was not finalized within 24 hours'
  where status = 'uploading'
    and created_at < now() - interval '24 hours';

  get diagnostics v_count = row_count;

  return v_count;
end;
$$;

revoke all on function public.expire_stale_render_uploads() from public, anon, authenticated;
grant execute on function public.expire_stale_render_uploads() to service_role;
-- ----------------------------------------------------------------------
-- project-assets takes a render's WebVTT captions
-- ----------------------------------------------------------------------
-- UPLOAD_CONSTRAINTS gains a captions category (text/vtt, 2 MB) for the
-- sidecar request_render_upload signs; the bucket's list stays exactly
-- ALLOWED_PROJECT_ASSET_TYPES (KB-28, allowed-types.test.ts). The size
-- limit is unchanged (video, 500 MB).
update storage.buckets
set
  allowed_mime_types = array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg',
    'audio/mp4',
    'text/vtt'
  ]
where id = 'project-assets';
