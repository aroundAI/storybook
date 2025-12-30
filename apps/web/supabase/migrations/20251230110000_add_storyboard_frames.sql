-- Migration: Add first_frame_url and last_frame_url to shots table
-- Date: 2025-12-30
-- Description: Adds columns for storyboard visualization frames

-- Add the columns if they don't exist
ALTER TABLE public.shots 
ADD COLUMN IF NOT EXISTS first_frame_url text,
ADD COLUMN IF NOT EXISTS last_frame_url text;

-- Add comments
COMMENT ON COLUMN public.shots.first_frame_url IS 'URL for first frame storyboard image';
COMMENT ON COLUMN public.shots.last_frame_url IS 'URL for last frame storyboard image';
