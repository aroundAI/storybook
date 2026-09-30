-- FILM-202. createCharacterAction inserted the asset, then its details, and
-- deleted the asset if the details failed. That delete runs under RLS, and
-- assets_delete admits only project owners and admins, so when a plain member's
-- details insert failed the asset stayed behind (character-create-rollback.test.sql).
-- The function already does both inserts in one transaction as SECURITY
-- DEFINER, so the action calls it; it now also takes the two image URLs the
-- action wrote.

drop function if exists public.create_character_with_details(
  uuid, varchar, text, jsonb, text, text, text[], text
);

create or replace function public.create_character_with_details(
  p_project_id uuid,
  p_name varchar(255),
  p_description text default null,
  p_physical_attributes jsonb default null,
  p_personality text default null,
  p_element_prompt text default null,
  p_reference_images text[] default null,
  p_elevenlabs_voice_id text default null,
  p_file_url text default null,
  p_thumbnail_url text default null
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
  insert into public.assets (project_id, type, name, description, file_url, thumbnail_url, metadata)
  values (p_project_id, 'character', p_name, p_description, p_file_url, p_thumbnail_url, '{}'::jsonb)
  returning id into v_asset_id;

  -- Create character details
  insert into public.character_details (
    asset_id, physical_attributes, personality,
    element_prompt, reference_images, elevenlabs_voice_id
  ) values (
    v_asset_id, p_physical_attributes, p_personality,
    p_element_prompt, p_reference_images, p_elevenlabs_voice_id
  );

  return v_asset_id;
exception
  when others then
    raise exception 'Failed to create character: %', sqlerrm;
end;
$$;

grant execute on function public.create_character_with_details(
  uuid, varchar, text, jsonb, text, text, text[], text, text, text
) to authenticated;

comment on function public.create_character_with_details is
  'Atomically creates a character asset and its details. Rolls back both on failure.';
