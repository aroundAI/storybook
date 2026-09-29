-- KB-140: create_character_with_details wrote character_details.voice_asset_id,
-- which 20251225160000 renamed to elevenlabs_voice_id (text), so every call
-- failed. Replace it: the last parameter is now the ElevenLabs voice id.

drop function if exists public.create_character_with_details(
  uuid, varchar, text, jsonb, text, text, text[], uuid
);

create or replace function public.create_character_with_details(
  p_project_id uuid,
  p_name varchar(255),
  p_description text,
  p_physical_attributes jsonb,
  p_personality text,
  p_element_prompt text,
  p_reference_images text[],
  p_elevenlabs_voice_id text default null
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
  uuid, varchar, text, jsonb, text, text, text[], text
) to authenticated;

comment on function public.create_character_with_details is
  'Atomically creates a character asset and its details. Rolls back both on failure.';
