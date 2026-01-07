-- Migration: Add audio_settings column to projects table
-- Purpose: Per-project audio generation settings (voice, sfx, music models)

-- Add audio_settings JSONB column with default empty object
ALTER TABLE public.projects 
ADD COLUMN IF NOT EXISTS audio_settings jsonb DEFAULT '{}'::jsonb;

-- Add comment describing the column
COMMENT ON COLUMN public.projects.audio_settings IS 'Per-project audio generation settings (voice, sfx, music models)';

-- Schema for audio_settings JSON:
-- {
--   "elevenlabs": {
--     "enabled": true,
--     "tts_model": "eleven_multilingual_v2",
--     "sfx_model": "eleven_multilingual_v2"
--   },
--   "voice_provider": "elevenlabs" | "playht" | "azure" | "google",
--   "sfx_provider": "elevenlabs",
--   "music_provider": "suno" | "udio"
-- }
