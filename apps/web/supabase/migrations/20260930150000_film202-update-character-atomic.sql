-- FILM-202. updateCharacterAction updated the asset, committed, then upserted
-- the details, so a failed details write left the asset change applied. This
-- function does both writes in one transaction. Each patch applies only the
-- keys it contains, so an absent key keeps its value and an explicit null
-- clears it; the physical_attributes patch merges into the stored object.
-- SECURITY DEFINER so the details write does not depend on which of the two
-- tables' policies the caller passes; authorization is the explicit
-- can_write_project check, and a missing character is reported the same way as
-- a forbidden one.

create or replace function public.update_character_with_details(
  p_asset_id uuid,
  p_asset_patch jsonb default '{}'::jsonb,
  p_details_patch jsonb default '{}'::jsonb,
  p_attributes_patch jsonb default '{}'::jsonb
) returns void
language plpgsql
security definer
set search_path = '' as $$
declare
  v_project_id uuid;
begin
  select a.project_id into v_project_id
  from public.assets a
  where a.id = p_asset_id
    and a.type = 'character'
    and a.deleted_at is null;

  if v_project_id is null or not public.can_write_project(v_project_id) then
    raise exception 'Access denied: insufficient project permissions'
      using errcode = '42501';
  end if;

  if p_asset_patch <> '{}'::jsonb then
    update public.assets a
    set name = case when p_asset_patch ? 'name' then p_asset_patch ->> 'name' else a.name end,
        description = case when p_asset_patch ? 'description' then p_asset_patch ->> 'description' else a.description end,
        file_url = case when p_asset_patch ? 'file_url' then p_asset_patch ->> 'file_url' else a.file_url end,
        thumbnail_url = case when p_asset_patch ? 'thumbnail_url' then p_asset_patch ->> 'thumbnail_url' else a.thumbnail_url end,
        updated_at = now()
    where a.id = p_asset_id;
  end if;

  if p_details_patch <> '{}'::jsonb or p_attributes_patch <> '{}'::jsonb then
    insert into public.character_details as cd (
      asset_id, physical_attributes, personality,
      element_prompt, reference_images, elevenlabs_voice_id
    ) values (
      p_asset_id,
      nullif(p_attributes_patch, '{}'::jsonb),
      p_details_patch ->> 'personality',
      p_details_patch ->> 'element_prompt',
      case when jsonb_typeof(p_details_patch -> 'reference_images') = 'array'
        then array(select jsonb_array_elements_text(p_details_patch -> 'reference_images'))
      end,
      p_details_patch ->> 'elevenlabs_voice_id'
    )
    on conflict (asset_id) do update
    set physical_attributes = case
          when p_attributes_patch = '{}'::jsonb then cd.physical_attributes
          else coalesce(cd.physical_attributes, '{}'::jsonb) || p_attributes_patch
        end,
        personality = case when p_details_patch ? 'personality' then excluded.personality else cd.personality end,
        element_prompt = case when p_details_patch ? 'element_prompt' then excluded.element_prompt else cd.element_prompt end,
        reference_images = case when p_details_patch ? 'reference_images' then excluded.reference_images else cd.reference_images end,
        elevenlabs_voice_id = case when p_details_patch ? 'elevenlabs_voice_id' then excluded.elevenlabs_voice_id else cd.elevenlabs_voice_id end;
  end if;
end;
$$;

revoke all on function public.update_character_with_details(uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.update_character_with_details(uuid, jsonb, jsonb, jsonb) to authenticated;

comment on function public.update_character_with_details is
  'Atomically updates a character asset and its details. A failure in either write rolls back both.';
