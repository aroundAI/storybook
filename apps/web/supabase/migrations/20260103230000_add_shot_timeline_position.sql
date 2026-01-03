-- Migration: Add timeline_start_seconds to shots
-- Allows clips to be positioned at any point on the timeline

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS timeline_start_seconds DECIMAL(10, 3) DEFAULT NULL;

-- Comment for documentation
COMMENT ON COLUMN public.shots.timeline_start_seconds IS 'Position of clip on timeline in seconds. NULL means sequential based on sequence_number.';
