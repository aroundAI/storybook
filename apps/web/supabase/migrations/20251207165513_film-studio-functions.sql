-- FILM-103: Transaction Functions for Film Studio
-- Multi-table operations requiring atomic transactions
-- All functions use SECURITY DEFINER for atomicity with EXPLICIT authorization checks
-- IMPORTANT: SECURITY DEFINER bypasses RLS, so each function validates permissions manually

-- =============================================================================
-- 1. create_character_with_details
-- Atomically creates an asset (type='character') and its character_details
-- =============================================================================

create or replace function public.create_character_with_details(
  p_project_id uuid,
  p_name varchar(255),
  p_description text,
  p_physical_attributes jsonb,
  p_personality text,
  p_element_prompt text,
  p_reference_images text[],
  p_voice_asset_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = '' as $$
declare
  v_asset_id uuid;
begin
  -- CRITICAL: Validate user has access to this project
  if not exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Access denied: insufficient project permissions';
  end if;

  -- Create asset record
  insert into public.assets (project_id, type, name, description)
  values (p_project_id, 'character', p_name, p_description)
  returning id into v_asset_id;

  -- Create character details
  insert into public.character_details (
    asset_id, physical_attributes, personality,
    element_prompt, reference_images, voice_asset_id
  ) values (
    v_asset_id, p_physical_attributes, p_personality,
    p_element_prompt, p_reference_images, p_voice_asset_id
  );

  return v_asset_id;
exception
  when others then
    raise exception 'Failed to create character: %', sqlerrm;
end;
$$;

grant execute on function public.create_character_with_details(
  uuid, varchar, text, jsonb, text, text, text[], uuid
) to authenticated;

comment on function public.create_character_with_details is
  'Atomically creates a character asset and its details. Rolls back both on failure.';

-- =============================================================================
-- 2. update_episode_with_lock
-- Optimistic locking for concurrent episode updates using version column
-- =============================================================================

create or replace function public.update_episode_with_lock(
  p_episode_id uuid,
  p_expected_version integer,
  p_updates jsonb
) returns table(success boolean, new_version integer, conflict_data jsonb)
language plpgsql
security definer
set search_path = '' as $$
declare
  v_current_version integer;
  v_current_data jsonb;
  v_project_id uuid;
begin
  -- Get episode's project_id for authorization check
  select e.project_id into v_project_id
  from public.episodes e
  where e.id = p_episode_id;

  if v_project_id is null then
    return query select false, null::integer, null::jsonb;
    return;
  end if;

  -- CRITICAL: Validate user has access to this project
  if not exists (
    select 1 from public.project_members pm
    where pm.project_id = v_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Access denied: insufficient project permissions';
  end if;

  -- Get current version with row lock
  select e.version, to_jsonb(e.*) into v_current_version, v_current_data
  from public.episodes e
  where e.id = p_episode_id
  for update;

  -- Check for version conflict
  if v_current_version != p_expected_version then
    -- Conflict detected - return current data for resolution
    return query select false, v_current_version, v_current_data;
    return;
  end if;

  -- Apply updates
  update public.episodes set
    title = coalesce(p_updates->>'title', title),
    description = coalesce(p_updates->>'description', description),
    status = coalesce(p_updates->>'status', status),
    story_data = coalesce(p_updates->'story_data', story_data),
    screenplay_data = coalesce(p_updates->'screenplay_data', screenplay_data),
    shot_list = coalesce(p_updates->'shot_list', shot_list),
    metadata = coalesce(p_updates->'metadata', metadata),
    version = version + 1,
    updated_at = now()
  where id = p_episode_id;

  return query select true, v_current_version + 1, null::jsonb;
end;
$$;

grant execute on function public.update_episode_with_lock(uuid, integer, jsonb) to authenticated;

comment on function public.update_episode_with_lock is
  'Updates an episode with optimistic locking. Returns conflict data on version mismatch.';

-- =============================================================================
-- 3. batch_create_shots
-- Atomically replaces all shots for an episode
-- =============================================================================

create or replace function public.batch_create_shots(
  p_episode_id uuid,
  p_shots jsonb -- Array of shot objects
) returns setof uuid
language plpgsql
security definer
set search_path = '' as $$
declare
  v_shot jsonb;
  v_shot_id uuid;
  v_sequence integer := 1;
  v_project_id uuid;
begin
  -- Get episode's project_id and lock the row
  select e.project_id into v_project_id
  from public.episodes e
  where e.id = p_episode_id
  for update;

  if v_project_id is null then
    raise exception 'Episode not found: %', p_episode_id;
  end if;

  -- CRITICAL: Validate user has access to this project
  if not exists (
    select 1 from public.project_members pm
    where pm.project_id = v_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
  ) then
    raise exception 'Access denied: insufficient project permissions';
  end if;

  -- Delete existing shots for this episode
  delete from public.shots where episode_id = p_episode_id;

  -- Insert new shots
  for v_shot in select * from jsonb_array_elements(p_shots)
  loop
    insert into public.shots (
      episode_id, sequence_number, duration_seconds,
      scene_description, action_description, prompt,
      camera_direction, status
    ) values (
      p_episode_id,
      v_sequence,
      coalesce(
        case when (v_shot->>'duration_seconds') ~ '^\d+$'
          then (v_shot->>'duration_seconds')::integer
          else null
        end,
        10
      ),
      v_shot->>'scene_description',
      v_shot->>'action_description',
      v_shot->>'prompt',
      v_shot->>'camera_direction',
      'pending'
    ) returning id into v_shot_id;

    v_sequence := v_sequence + 1;
    return next v_shot_id;
  end loop;

  -- Update episode status
  update public.episodes
  set status = 'storyboard', updated_at = now()
  where id = p_episode_id;
end;
$$;

grant execute on function public.batch_create_shots(uuid, jsonb) to authenticated;

comment on function public.batch_create_shots is
  'Replaces all shots for an episode atomically. Returns array of new shot IDs.';

-- =============================================================================
-- 4. soft_delete_episode
-- Soft deletes an episode and cancels pending generation jobs
-- =============================================================================

create or replace function public.soft_delete_episode(
  p_episode_id uuid
) returns boolean
language plpgsql
security definer
set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_project_id uuid;
begin
  -- Get episode's project_id for authorization check
  select e.project_id into v_project_id
  from public.episodes e
  where e.id = p_episode_id and e.deleted_at is null;

  if v_project_id is null then
    return false;
  end if;

  -- CRITICAL: Validate user has delete access (owner or admin only)
  if not exists (
    select 1 from public.project_members pm
    where pm.project_id = v_project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
  ) then
    raise exception 'Access denied: only project owners and admins can delete episodes';
  end if;

  -- Soft delete the episode
  update public.episodes
  set deleted_at = v_now, updated_at = v_now
  where id = p_episode_id and deleted_at is null;

  if not found then
    return false;
  end if;

  -- Cancel any pending generation jobs for shots in this episode
  update public.generation_jobs
  set status = 'cancelled', completed_at = v_now
  where reference_type = 'shot'
    and reference_id in (select id from public.shots where episode_id = p_episode_id)
    and status in ('queued', 'processing');

  return true;
end;
$$;

grant execute on function public.soft_delete_episode(uuid) to authenticated;

comment on function public.soft_delete_episode is
  'Soft deletes an episode and cancels pending generation jobs.';

-- =============================================================================
-- 5. get_project_generation_costs
-- Aggregates generation costs per project with optional date filtering
-- =============================================================================

create or replace function public.get_project_generation_costs(
  p_project_id uuid,
  p_start_date timestamptz default null,
  p_end_date timestamptz default null
) returns table(
  job_type varchar(50),
  provider varchar(50),
  total_cost_cents bigint,
  job_count bigint,
  completed_count bigint,
  failed_count bigint
)
language plpgsql
security definer
set search_path = '' as $$
begin
  -- CRITICAL: Validate user has access to view this project's data
  if not exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id
      and pm.user_id = auth.uid()
  ) then
    raise exception 'Access denied: insufficient project permissions';
  end if;

  return query
  select
    gj.job_type,
    gj.provider,
    coalesce(sum(gj.cost_cents), 0)::bigint as total_cost_cents,
    count(*)::bigint as job_count,
    count(*) filter (where gj.status = 'completed')::bigint as completed_count,
    count(*) filter (where gj.status = 'failed')::bigint as failed_count
  from public.generation_jobs gj
  where gj.project_id = p_project_id
    and (p_start_date is null or gj.created_at >= p_start_date)
    and (p_end_date is null or gj.created_at <= p_end_date)
  group by gj.job_type, gj.provider
  order by total_cost_cents desc;
end;
$$;

grant execute on function public.get_project_generation_costs(uuid, timestamptz, timestamptz) to authenticated;

comment on function public.get_project_generation_costs is
  'Aggregates generation costs by job type and provider for a project.';
