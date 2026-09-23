/*
 * KB-40: only a project's writers may assemble (and so replace) an episode's
 * edit project.
 *
 * batch_assemble_edit_project is SECURITY DEFINER and callable over
 * PostgREST by any signed-in user. It authorised by checking that
 * `p_user_id` -- a parameter -- belonged to the episode's account, and never
 * compared it with the caller. Any user who named the project owner's id
 * (readable on every public project row) could delete and replace any
 * episode's timeline, public or private. The account-membership rule was
 * also wider than the project-write rule: project viewers and account members
 * with no project role could replace timelines, and personal-account owners
 * (who have no accounts_memberships row) could not assemble their own.
 *
 * Now the caller is auth.uid(), and the rule is public.can_write_project
 * (KB-28): owner, admin or member in project_members. Every refusal -- not a
 * writer, not signed in, episode missing or soft-deleted -- raises the same
 * 42501 before anything is deleted, so the call is not an existence oracle.
 * p_user_id is removed, not ignored: a parameter that means nothing invites
 * being trusted again. The body after the check is unchanged.
 *
 * Tests: tests/database/edit-project-assemble-access.test.sql.
 */

drop function if exists public.batch_assemble_edit_project(
  uuid, uuid, integer, integer, integer, varchar, text, text, text, text
);

create function public.batch_assemble_edit_project(
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
set search_path = ''
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
  v_uid uuid := auth.uid();
  v_episode_project_id uuid;
  -- Cast text params to jsonb
  j_tracks jsonb;
  j_clips jsonb;
  j_keyframes jsonb;
  j_sync_groups jsonb;
begin
  select e.project_id into v_episode_project_id
  from public.episodes e
  where e.id = p_episode_id and e.deleted_at is null;

  if v_uid is null
     or v_episode_project_id is null
     or not public.can_write_project(v_episode_project_id) then
    raise exception 'No write access to this episode''s timeline'
      using errcode = '42501';
  end if;

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

revoke all on function public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, text, text, text, text
) from public, anon;

grant execute on function public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, text, text, text, text
) to authenticated, service_role;

comment on function public.batch_assemble_edit_project(
  uuid, integer, integer, integer, varchar, text, text, text, text
) is
  'Replaces an episode''s edit project (tracks, sync groups, clips, keyframes) in one transaction. The caller is auth.uid() and must satisfy can_write_project(<episode''s project>); otherwise 42501 and nothing is written (KB-40).';
