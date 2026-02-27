-- ==================================
-- Fix: batch_assemble_edit_project
-- ==================================
-- Issues fixed:
-- 1. Unique constraint violation: DELETE existing project before INSERT
-- 2. Permission denied: GRANT EXECUTE to authenticated/service_role
-- 3. Double-serialized JSON: Accept text params and cast to jsonb internally
--    (JS client calls JSON.stringify() before passing to client.rpc(),
--     causing double-encoding when params are typed as jsonb)

-- Drop the old jsonb-parameter version
drop function if exists public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, jsonb, jsonb, jsonb, jsonb
);

create or replace function public.batch_assemble_edit_project(
  p_episode_id uuid,
  p_width integer default 1920,
  p_height integer default 1080,
  p_fps integer default 30,
  p_active_language varchar default 'en',
  p_tracks text default '[]',
  p_clips text default '[]',
  p_keyframes text default '[]',
  p_sync_groups text default '[]'
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
  -- Cast text params to jsonb
  j_tracks jsonb;
  j_clips jsonb;
  j_keyframes jsonb;
  j_sync_groups jsonb;
begin
  -- Parse text inputs as jsonb
  j_tracks := p_tracks::jsonb;
  j_clips := p_clips::jsonb;
  j_keyframes := p_keyframes::jsonb;
  j_sync_groups := p_sync_groups::jsonb;

  -- 0. Delete existing project for this episode (cascade deletes
  --    tracks, clips, keyframes, transitions, sync groups)
  delete from public.edit_projects where episode_id = p_episode_id;

  -- 1. Create edit project
  insert into public.edit_projects (episode_id, width, height, fps, active_language)
  values (p_episode_id, p_width, p_height, p_fps, p_active_language)
  returning id into v_project_id;

  -- 2. Create tracks (in order)
  v_track_ids := array[]::uuid[];
  for v_track in select * from jsonb_array_elements(j_tracks) with ordinality as t(elem, idx)
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
  for v_sg in select * from jsonb_array_elements(j_sync_groups) with ordinality as sg(elem, idx)
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
  for v_clip in select * from jsonb_array_elements(j_clips) with ordinality as c(elem, idx)
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
  for v_sg in select * from jsonb_array_elements(j_sync_groups) with ordinality as sg(elem, idx)
  loop
    if v_sg.elem->>'primaryClipIndex' is not null then
      v_idx := (v_sg.elem->>'primaryClipIndex')::integer;
      update public.dialogue_sync_groups
      set primary_clip_id = v_clip_ids[v_idx + 1]
      where id = v_sync_group_ids[v_sg.idx::integer];
    end if;
  end loop;

  -- 6. Create keyframes (resolve clipIndex → clip ID)
  for v_kf in select * from jsonb_array_elements(j_keyframes)
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
    'keyframeCount', jsonb_array_length(j_keyframes),
    'syncGroupCount', array_length(v_sync_group_ids, 1)
  );
end;
$$;

-- Grant EXECUTE permissions
grant execute on function public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, text, text, text, text
) to authenticated;

grant execute on function public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, text, text, text, text
) to service_role;
