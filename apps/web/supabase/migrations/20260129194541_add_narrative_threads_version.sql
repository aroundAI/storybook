-- Migration: Add version column to narrative_threads for optimistic locking
-- This prevents race conditions when concurrent updates occur

ALTER TABLE public.narrative_threads 
ADD COLUMN IF NOT EXISTS version integer DEFAULT 1 NOT NULL;

COMMENT ON COLUMN public.narrative_threads.version IS 'Version number for optimistic locking to prevent concurrent update conflicts';
