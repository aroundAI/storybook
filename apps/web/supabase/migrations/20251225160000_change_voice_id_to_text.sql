-- Migration: Change voice_asset_id from UUID to TEXT for ElevenLabs voice IDs
-- The voice_asset_id column was originally designed as a FK to the assets table (UUID),
-- but with the new ElevenLabs direct voice selection, we store the ElevenLabs voice ID
-- (alphanumeric string like "KuySkhkHB2yli6OmmYEU") directly.

-- Drop the foreign key constraint and index first
alter table public.character_details 
  drop constraint if exists character_details_voice_asset_id_fkey;

drop index if exists public.idx_character_details_voice_asset_id;

-- Change the column type from UUID to TEXT
alter table public.character_details 
  alter column voice_asset_id type text using voice_asset_id::text;

-- Rename the column to better reflect its purpose
alter table public.character_details 
  rename column voice_asset_id to elevenlabs_voice_id;

-- Update the comment
comment on column public.character_details.elevenlabs_voice_id is 'ElevenLabs voice ID for this character (e.g., "KuySkhkHB2yli6OmmYEU")';

-- Create a new index
create index if not exists idx_character_details_elevenlabs_voice_id 
  on public.character_details(elevenlabs_voice_id) 
  where elevenlabs_voice_id is not null;
