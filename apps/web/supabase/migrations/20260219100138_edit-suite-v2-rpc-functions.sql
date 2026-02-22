-- ==================================
-- Edit Suite v2 — RPC Functions & RLS Fixes
-- ==================================
-- Addresses PR #192 review comments:
--   1. Atomic batch_assemble via PostgreSQL function
--   2. Atomic batch_save via PostgreSQL function
--   3. Atomic split_clip via PostgreSQL function
--   4. Missing UPDATE policies on dialogue_sync_groups + edit_transitions

-- ==================================
-- Section: Missing RLS Policies
-- ==================================

-- UPDATE policy for dialogue_sync_groups (was missing — needed by batchAssembleAction
-- to set primary_clip_id after clips are created)
create policy "dialogue_sync_groups_update" on public.dialogue_sync_groups for update
  to authenticated using (
    exists (
      select 1 from public.edit_projects ep
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where ep.id = dialogue_sync_groups.edit_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- UPDATE policy for edit_transitions (was missing — needed by updateTransitionAction)
create policy "edit_transitions_update" on public.edit_transitions for update
  to authenticated using (
    exists (
      select 1 from public.edit_clips c
      join public.edit_tracks t on t.id = c.track_id
      join public.edit_projects ep on ep.id = t.edit_project_id
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = edit_transitions.from_clip_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- ==================================
-- Section: RPC — batch_assemble_edit_project
-- ==================================
-- Atomically creates an entire edit project from auto-assembly:
--   project → tracks → sync groups → clips → keyframes
-- All in a single transaction (PostgreSQL functions are transactional).

create or replace function public.batch_assemble_edit_project(
  p_episode_id uuid,
  p_width integer default 1920,
  p_height integer default 1080,
  p_fps integer default 30,
  p_active_language varchar default 'en',
  p_tracks jsonb default '[]'::jsonb,
  p_clips jsonb default '[]'::jsonb,
  p_keyframes jsonb default '[]'::jsonb,
  p_sync_groups jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_track_ids uuid[];
  v_sync_group_ids uuid[];
  v_clip_ids uuid[];
  v_track record;
  v_sg record;
  v_clip record;
  v_kf record;
  v_track_id uuid;
  v_sg_id uuid;
  v_clip_id uuid;
  v_idx integer;
begin
  -- 1. Create edit project
  insert into public.edit_projects (episode_id, width, height, fps, active_language)
  values (p_episode_id, p_width, p_height, p_fps, p_active_language)
  returning id into v_project_id;

  -- 2. Create tracks (in order)
  v_track_ids := array[]::uuid[];
  for v_track in select * from jsonb_array_elements(p_tracks) with ordinality as t(elem, idx)
  loop
    insert into public.edit_tracks (
      edit_project_id, type, name, sort_order, volume
    ) values (
      v_project_id,
      (v_track.elem->>'type')::varchar,
      (v_track.elem->>'name')::varchar,
      coalesce((v_track.elem->>'sortOrder')::integer, v_track.idx::integer - 1),
      coalesce((v_track.elem->>'volume')::decimal, 1.0)
    )
    returning id into v_track_id;
    v_track_ids := array_append(v_track_ids, v_track_id);
  end loop;

  -- 3. Create sync groups
  v_sync_group_ids := array[]::uuid[];
  for v_sg in select * from jsonb_array_elements(p_sync_groups) with ordinality as sg(elem, idx)
  loop
    insert into public.dialogue_sync_groups (
      edit_project_id, anchor_dialogue_id
    ) values (
      v_project_id,
      (v_sg.elem->>'anchorDialogueId')::uuid
    )
    returning id into v_sg_id;
    v_sync_group_ids := array_append(v_sync_group_ids, v_sg_id);
  end loop;

  -- 4. Create clips (resolve trackIndex → track ID, syncGroupIndex → sync group ID)
  v_clip_ids := array[]::uuid[];
  for v_clip in select * from jsonb_array_elements(p_clips) with ordinality as c(elem, idx)
  loop
    v_idx := (v_clip.elem->>'trackIndex')::integer;
    insert into public.edit_clips (
      track_id, source_shot_id, source_dialogue_id,
      source_dubbed_dialogue_id, source_audio_track_id,
      source_upload_url, media_url, thumbnail_url,
      start_ms, end_ms, in_point_ms, out_point_ms,
      volume, speed, fade_in_ms, fade_out_ms,
      sort_order, sync_group_id, language, is_active
    ) values (
      v_track_ids[v_idx + 1],  -- 0-indexed → 1-indexed
      (v_clip.elem->>'sourceShotId')::uuid,
      (v_clip.elem->>'sourceDialogueId')::uuid,
      (v_clip.elem->>'sourceDubbedDialogueId')::uuid,
      (v_clip.elem->>'sourceAudioTrackId')::uuid,
      v_clip.elem->>'sourceUploadUrl',
      v_clip.elem->>'mediaUrl',
      v_clip.elem->>'thumbnailUrl',
      (v_clip.elem->>'startMs')::integer,
      (v_clip.elem->>'endMs')::integer,
      coalesce((v_clip.elem->>'inPointMs')::integer, 0),
      (v_clip.elem->>'outPointMs')::integer,
      coalesce((v_clip.elem->>'volume')::decimal, 1.0),
      coalesce((v_clip.elem->>'speed')::decimal, 1.0),
      coalesce((v_clip.elem->>'fadeInMs')::integer, 0),
      coalesce((v_clip.elem->>'fadeOutMs')::integer, 0),
      coalesce((v_clip.elem->>'sortOrder')::integer, 0),
      case when v_clip.elem->>'syncGroupIndex' is not null
        then v_sync_group_ids[(v_clip.elem->>'syncGroupIndex')::integer + 1]
        else null
      end,
      v_clip.elem->>'language',
      coalesce((v_clip.elem->>'isActive')::boolean, true)
    )
    returning id into v_clip_id;
    v_clip_ids := array_append(v_clip_ids, v_clip_id);
  end loop;

  -- 5. Update primary_clip_id on sync groups
  for v_sg in select * from jsonb_array_elements(p_sync_groups) with ordinality as sg(elem, idx)
  loop
    if v_sg.elem->>'primaryClipIndex' is not null then
      v_idx := (v_sg.elem->>'primaryClipIndex')::integer;
      update public.dialogue_sync_groups
      set primary_clip_id = v_clip_ids[v_idx + 1]
      where id = v_sync_group_ids[v_sg.idx::integer];
    end if;
  end loop;

  -- 6. Create keyframes (resolve clipIndex → clip ID)
  for v_kf in select * from jsonb_array_elements(p_keyframes)
  loop
    v_idx := (v_kf.value->>'clipIndex')::integer;
    insert into public.edit_keyframes (
      clip_id, property, offset_ms, value, easing
    ) values (
      v_clip_ids[v_idx + 1],
      (v_kf.value->>'property')::varchar,
      (v_kf.value->>'offsetMs')::integer,
      (v_kf.value->>'value')::decimal,
      coalesce((v_kf.value->>'easing')::varchar, 'linear')
    );
  end loop;

  -- Return summary
  return jsonb_build_object(
    'projectId', v_project_id,
    'trackCount', array_length(v_track_ids, 1),
    'clipCount', array_length(v_clip_ids, 1),
    'keyframeCount', jsonb_array_length(p_keyframes),
    'syncGroupCount', array_length(v_sync_group_ids, 1)
  );
end;
$$;

comment on function public.batch_assemble_edit_project is
  'Atomically creates an edit project with all tracks, clips, sync groups, and keyframes in a single transaction';

-- ==================================
-- Section: RPC — batch_save_edit_project
-- ==================================
-- Atomically persists dirty client state:
--   updates + deletes + creates for tracks, clips, and keyframes.

create or replace function public.batch_save_edit_project(
  p_edit_project_id uuid,
  p_dirty_tracks jsonb default '[]'::jsonb,
  p_dirty_clips jsonb default '[]'::jsonb,
  p_dirty_keyframes jsonb default '[]'::jsonb,
  p_deleted_clip_ids jsonb default '[]'::jsonb,
  p_deleted_keyframe_ids jsonb default '[]'::jsonb,
  p_new_clips jsonb default '[]'::jsonb,
  p_new_keyframes jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_track record;
  v_clip record;
  v_kf record;
  v_updated_tracks integer := 0;
  v_updated_clips integer := 0;
  v_updated_keyframes integer := 0;
  v_deleted_clips integer := 0;
  v_deleted_keyframes integer := 0;
  v_created_clips integer := 0;
  v_created_keyframes integer := 0;
  v_del_ids uuid[];
begin
  -- 1. Update dirty tracks
  for v_track in select * from jsonb_array_elements(p_dirty_tracks)
  loop
    update public.edit_tracks set
      name = coalesce(v_track.value->>'name', name),
      sort_order = coalesce((v_track.value->>'sortOrder')::integer, sort_order),
      volume = coalesce((v_track.value->>'volume')::decimal, volume),
      is_muted = coalesce((v_track.value->>'isMuted')::boolean, is_muted),
      is_solo = coalesce((v_track.value->>'isSolo')::boolean, is_solo),
      is_locked = coalesce((v_track.value->>'isLocked')::boolean, is_locked),
      height = coalesce((v_track.value->>'height')::integer, height),
      updated_at = v_now
    where id = (v_track.value->>'id')::uuid;
    v_updated_tracks := v_updated_tracks + 1;
  end loop;

  -- 2. Delete clips (cascades keyframes via FK)
  if jsonb_array_length(p_deleted_clip_ids) > 0 then
    select array_agg(elem::text::uuid)
    into v_del_ids
    from jsonb_array_elements_text(p_deleted_clip_ids) as elem;

    delete from public.edit_clips where id = any(v_del_ids);
    v_deleted_clips := array_length(v_del_ids, 1);
  end if;

  -- 3. Delete keyframes
  if jsonb_array_length(p_deleted_keyframe_ids) > 0 then
    select array_agg(elem::text::uuid)
    into v_del_ids
    from jsonb_array_elements_text(p_deleted_keyframe_ids) as elem;

    delete from public.edit_keyframes where id = any(v_del_ids);
    v_deleted_keyframes := array_length(v_del_ids, 1);
  end if;

  -- 4. Update dirty clips
  for v_clip in select * from jsonb_array_elements(p_dirty_clips)
  loop
    update public.edit_clips set
      start_ms = coalesce((v_clip.value->>'startMs')::integer, start_ms),
      end_ms = coalesce((v_clip.value->>'endMs')::integer, end_ms),
      in_point_ms = coalesce((v_clip.value->>'inPointMs')::integer, in_point_ms),
      out_point_ms = coalesce((v_clip.value->>'outPointMs')::integer, out_point_ms),
      volume = coalesce((v_clip.value->>'volume')::decimal, volume),
      speed = coalesce((v_clip.value->>'speed')::decimal, speed),
      fade_in_ms = coalesce((v_clip.value->>'fadeInMs')::integer, fade_in_ms),
      fade_out_ms = coalesce((v_clip.value->>'fadeOutMs')::integer, fade_out_ms),
      sort_order = coalesce((v_clip.value->>'sortOrder')::integer, sort_order),
      is_active = coalesce((v_clip.value->>'isActive')::boolean, is_active),
      updated_at = v_now
    where id = (v_clip.value->>'id')::uuid;
    v_updated_clips := v_updated_clips + 1;
  end loop;

  -- 5. Update dirty keyframes
  for v_kf in select * from jsonb_array_elements(p_dirty_keyframes)
  loop
    update public.edit_keyframes set
      offset_ms = coalesce((v_kf.value->>'offsetMs')::integer, offset_ms),
      value = coalesce((v_kf.value->>'value')::decimal, value),
      easing = coalesce((v_kf.value->>'easing')::varchar, easing),
      bezier_cp1_x = case when v_kf.value ? 'bezierCp1X' then (v_kf.value->>'bezierCp1X')::decimal else bezier_cp1_x end,
      bezier_cp1_y = case when v_kf.value ? 'bezierCp1Y' then (v_kf.value->>'bezierCp1Y')::decimal else bezier_cp1_y end,
      bezier_cp2_x = case when v_kf.value ? 'bezierCp2X' then (v_kf.value->>'bezierCp2X')::decimal else bezier_cp2_x end,
      bezier_cp2_y = case when v_kf.value ? 'bezierCp2Y' then (v_kf.value->>'bezierCp2Y')::decimal else bezier_cp2_y end
    where id = (v_kf.value->>'id')::uuid;
    v_updated_keyframes := v_updated_keyframes + 1;
  end loop;

  -- 6. Create new clips
  for v_clip in select * from jsonb_array_elements(p_new_clips)
  loop
    insert into public.edit_clips (
      track_id, source_shot_id, source_dialogue_id,
      source_dubbed_dialogue_id, source_audio_track_id,
      source_upload_url, media_url, thumbnail_url,
      start_ms, end_ms, in_point_ms, out_point_ms,
      volume, speed, fade_in_ms, fade_out_ms,
      sort_order, sync_group_id, language, is_active
    ) values (
      (v_clip.value->>'trackId')::uuid,
      (v_clip.value->>'sourceShotId')::uuid,
      (v_clip.value->>'sourceDialogueId')::uuid,
      (v_clip.value->>'sourceDubbedDialogueId')::uuid,
      (v_clip.value->>'sourceAudioTrackId')::uuid,
      v_clip.value->>'sourceUploadUrl',
      v_clip.value->>'mediaUrl',
      v_clip.value->>'thumbnailUrl',
      (v_clip.value->>'startMs')::integer,
      (v_clip.value->>'endMs')::integer,
      coalesce((v_clip.value->>'inPointMs')::integer, 0),
      (v_clip.value->>'outPointMs')::integer,
      coalesce((v_clip.value->>'volume')::decimal, 1.0),
      coalesce((v_clip.value->>'speed')::decimal, 1.0),
      coalesce((v_clip.value->>'fadeInMs')::integer, 0),
      coalesce((v_clip.value->>'fadeOutMs')::integer, 0),
      coalesce((v_clip.value->>'sortOrder')::integer, 0),
      (v_clip.value->>'syncGroupId')::uuid,
      v_clip.value->>'language',
      coalesce((v_clip.value->>'isActive')::boolean, true)
    );
    v_created_clips := v_created_clips + 1;
  end loop;

  -- 7. Create new keyframes
  for v_kf in select * from jsonb_array_elements(p_new_keyframes)
  loop
    insert into public.edit_keyframes (
      clip_id, property, offset_ms, value, easing,
      bezier_cp1_x, bezier_cp1_y, bezier_cp2_x, bezier_cp2_y
    ) values (
      (v_kf.value->>'clipId')::uuid,
      (v_kf.value->>'property')::varchar,
      (v_kf.value->>'offsetMs')::integer,
      (v_kf.value->>'value')::decimal,
      coalesce((v_kf.value->>'easing')::varchar, 'linear'),
      (v_kf.value->>'bezierCp1X')::decimal,
      (v_kf.value->>'bezierCp1Y')::decimal,
      (v_kf.value->>'bezierCp2X')::decimal,
      (v_kf.value->>'bezierCp2Y')::decimal
    );
    v_created_keyframes := v_created_keyframes + 1;
  end loop;

  -- 8. Bump project version + updated_at
  update public.edit_projects
  set version = version + 1, updated_at = v_now
  where id = p_edit_project_id;

  return jsonb_build_object(
    'updatedTracks', v_updated_tracks,
    'updatedClips', v_updated_clips,
    'updatedKeyframes', v_updated_keyframes,
    'deletedClips', v_deleted_clips,
    'deletedKeyframes', v_deleted_keyframes,
    'createdClips', v_created_clips,
    'createdKeyframes', v_created_keyframes
  );
end;
$$;

comment on function public.batch_save_edit_project is
  'Atomically saves dirty edit state (updates, deletes, creates) in a single transaction';

-- ==================================
-- Section: RPC — split_edit_clip
-- ==================================
-- Atomically splits a clip at a given timeline position:
--   1. Updates original clip (trims end)
--   2. Creates second clip (from split point)
--   3. Distributes keyframes across both clips
--   4. Clears outgoing fade on first clip

create or replace function public.split_edit_clip(
  p_clip_id uuid,
  p_split_at_ms integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_clip record;
  v_second_clip_id uuid;
  v_clip_duration integer;
  v_source_duration integer;
  v_split_ratio decimal;
  v_source_offset_at_split integer;
  v_split_offset_ms integer;
begin
  -- Fetch the clip to split
  select * into v_clip
  from public.edit_clips
  where id = p_clip_id;

  if v_clip is null then
    raise exception 'Clip not found: %', p_clip_id;
  end if;

  -- Validate split point
  if p_split_at_ms <= v_clip.start_ms or p_split_at_ms >= v_clip.end_ms then
    raise exception 'Split point must be within clip boundaries (% to %)', v_clip.start_ms, v_clip.end_ms;
  end if;

  -- Calculate source offset at split point
  v_clip_duration := v_clip.end_ms - v_clip.start_ms;
  v_source_duration := v_clip.out_point_ms - v_clip.in_point_ms;
  v_split_ratio := (p_split_at_ms - v_clip.start_ms)::decimal / v_clip_duration;
  v_source_offset_at_split := v_clip.in_point_ms + round(v_source_duration * v_split_ratio)::integer;
  v_split_offset_ms := p_split_at_ms - v_clip.start_ms;

  -- 1. Update first clip (trim end, remove outgoing fade)
  update public.edit_clips
  set end_ms = p_split_at_ms,
      out_point_ms = v_source_offset_at_split,
      fade_out_ms = 0,
      updated_at = now()
  where id = p_clip_id;

  -- 2. Create second clip
  insert into public.edit_clips (
    track_id, source_shot_id, source_dialogue_id,
    source_dubbed_dialogue_id, source_audio_track_id,
    source_upload_url, media_url, thumbnail_url,
    start_ms, end_ms, in_point_ms, out_point_ms,
    volume, speed, fade_in_ms, fade_out_ms,
    sort_order, sync_group_id, language, is_active
  ) values (
    v_clip.track_id, v_clip.source_shot_id, v_clip.source_dialogue_id,
    v_clip.source_dubbed_dialogue_id, v_clip.source_audio_track_id,
    v_clip.source_upload_url, v_clip.media_url, v_clip.thumbnail_url,
    p_split_at_ms, v_clip.end_ms, v_source_offset_at_split, v_clip.out_point_ms,
    v_clip.volume, v_clip.speed, 0, v_clip.fade_out_ms,
    v_clip.sort_order + 1, v_clip.sync_group_id, v_clip.language, v_clip.is_active
  )
  returning id into v_second_clip_id;

  -- 3. Copy keyframes beyond split point to second clip (with adjusted offset)
  insert into public.edit_keyframes (clip_id, property, offset_ms, value, easing,
    bezier_cp1_x, bezier_cp1_y, bezier_cp2_x, bezier_cp2_y)
  select v_second_clip_id, property, offset_ms - v_split_offset_ms, value, easing,
    bezier_cp1_x, bezier_cp1_y, bezier_cp2_x, bezier_cp2_y
  from public.edit_keyframes
  where clip_id = p_clip_id and offset_ms >= v_split_offset_ms;

  -- 4. Remove keyframes beyond split point from first clip
  delete from public.edit_keyframes
  where clip_id = p_clip_id and offset_ms > v_split_offset_ms;

  return jsonb_build_object(
    'firstClipId', p_clip_id,
    'secondClipId', v_second_clip_id
  );
end;
$$;

comment on function public.split_edit_clip is
  'Atomically splits a clip at a given timeline position, distributing keyframes across both halves';

-- ==================================
-- Section: RPC — create_edit_project_with_tracks
-- ==================================
-- Atomically creates an edit project and its default tracks
-- in a single transaction to prevent orphaned projects.

create or replace function public.create_edit_project_with_tracks(
  p_episode_id uuid,
  p_width integer default 1920,
  p_height integer default 1080,
  p_fps integer default 30,
  p_active_language varchar default 'en',
  p_default_tracks jsonb default '[
    {"type": "video", "name": "Video A", "sort_order": 0, "volume": 1.0},
    {"type": "video", "name": "Video B", "sort_order": 1, "volume": 1.0},
    {"type": "dialogue", "name": "Dialogue", "sort_order": 2, "volume": 1.0},
    {"type": "sfx", "name": "SFX", "sort_order": 3, "volume": 0.8},
    {"type": "music", "name": "Music", "sort_order": 4, "volume": 0.5}
  ]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_track record;
  v_track_count integer := 0;
begin
  -- 1. Create the edit project
  insert into public.edit_projects (episode_id, width, height, fps, active_language)
  values (p_episode_id, p_width, p_height, p_fps, p_active_language)
  returning id into v_project_id;

  -- 2. Create default tracks
  for v_track in select * from jsonb_array_elements(p_default_tracks)
  loop
    insert into public.edit_tracks (
      edit_project_id, type, name, sort_order, volume
    ) values (
      v_project_id,
      (v_track.value->>'type')::varchar,
      (v_track.value->>'name')::varchar,
      coalesce((v_track.value->>'sort_order')::integer, v_track_count),
      coalesce((v_track.value->>'volume')::decimal, 1.0)
    );
    v_track_count := v_track_count + 1;
  end loop;

  -- Return the created project (fetch full row for mapping)
  return (
    select jsonb_build_object(
      'id', ep.id,
      'episode_id', ep.episode_id,
      'width', ep.width,
      'height', ep.height,
      'fps', ep.fps,
      'active_language', ep.active_language,
      'render_status', ep.render_status,
      'version', ep.version,
      'created_at', ep.created_at,
      'updated_at', ep.updated_at,
      'track_count', v_track_count
    )
    from public.edit_projects ep
    where ep.id = v_project_id
  );
end;
$$;

comment on function public.create_edit_project_with_tracks is
  'Atomically creates an edit project with default tracks in a single transaction';
