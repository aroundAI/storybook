-- Migration: Remove deprecated voice_asset_id column and voice_profiles table
-- These were replaced by character_details.elevenlabs_voice_id for simpler voice management

-- Step 1: Drop the foreign key constraint index on voice_asset_id
DROP INDEX IF EXISTS idx_character_details_voice_asset_id;

-- Step 2: Remove the voice_asset_id column from character_details
-- This column is deprecated - voice is now stored in elevenlabs_voice_id
ALTER TABLE public.character_details DROP COLUMN IF EXISTS voice_asset_id;

-- Step 3: Drop voice_profiles table
-- Voice profiles are no longer used - voices are stored directly as ElevenLabs voice IDs
DROP TABLE IF EXISTS public.voice_profiles CASCADE;

-- Step 4: Drop voice_consent table (depends on voice_profiles)
-- This table stored consent records for voice cloning which depended on voice_profiles
DROP TABLE IF EXISTS public.voice_consent CASCADE;

-- Note: The voice_cloning.sql schema extensions should also be considered deprecated
