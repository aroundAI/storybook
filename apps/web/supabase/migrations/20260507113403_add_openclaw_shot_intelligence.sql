-- Migration: Add OpenClaw Shot Intelligence columns to shots table
-- Bridges human-judgment gaps for autonomous video generation:
--   1. Cut vs. Continuation decisions (transition_type, inherit_last_frame)
--   2. Frame descriptions for image generation (first_frame_description, last_frame_description)
--   3. Location specificity (location_area, location_environment_description)
--   4. Primary subject / frame strategy (primary_subject, frame_strategy)

-- ============================================================================
-- Transition & Frame Chain columns
-- ============================================================================

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS transition_type text
  CHECK (transition_type IS NULL OR transition_type IN (
    'continuation', 'cut', 'match_cut', 'j_cut', 'l_cut'
  ));

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS continuation_from_shot_id uuid
  REFERENCES public.shots(id) ON DELETE SET NULL;

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS inherit_last_frame boolean DEFAULT false;

COMMENT ON COLUMN public.shots.transition_type IS 'How this shot connects to the previous: continuation (same flow), cut (new angle), match_cut, j_cut, l_cut';
COMMENT ON COLUMN public.shots.continuation_from_shot_id IS 'FK to previous shot when transition_type is continuation — first frame inherited from that shot''s last frame';
COMMENT ON COLUMN public.shots.inherit_last_frame IS 'If true, this shot''s first frame = previous shot''s last frame (OpenClaw skips first-frame generation)';

-- ============================================================================
-- Frame Description columns (what the first/last frame should depict)
-- ============================================================================

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS first_frame_description text;

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS last_frame_description text;

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS first_frame_source text
  CHECK (first_frame_source IS NULL OR first_frame_source IN (
    'generated', 'inherited', 'manual'
  ));

COMMENT ON COLUMN public.shots.first_frame_description IS 'Text prompt describing the composition of the first frame for image generation on Flow';
COMMENT ON COLUMN public.shots.last_frame_description IS 'Text prompt describing the composition of the last frame for image generation on Flow';
COMMENT ON COLUMN public.shots.first_frame_source IS 'How the first frame was obtained: generated (new image), inherited (from previous shot), manual (user uploaded)';

-- ============================================================================
-- Location Specificity columns
-- ============================================================================

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS location_area text;

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS location_environment_description text;

COMMENT ON COLUMN public.shots.location_area IS 'Specific area within the location (e.g., "park bench under oak tree", "kitchen doorway")';
COMMENT ON COLUMN public.shots.location_environment_description IS 'Full prose description of the environment for first-frame generation — lighting, weather, time of day, spatial details';

-- ============================================================================
-- Primary Subject & Frame Strategy columns
-- ============================================================================

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS primary_subject jsonb;

ALTER TABLE public.shots
ADD COLUMN IF NOT EXISTS frame_strategy text
  CHECK (frame_strategy IS NULL OR frame_strategy IN (
    'character_focus', 'environment_focus', 'two_shot', 'group', 'detail_insert'
  ));

COMMENT ON COLUMN public.shots.primary_subject IS 'What the camera focuses on: { "type": "character"|"location"|"object", "name": "Dante" }';
COMMENT ON COLUMN public.shots.frame_strategy IS 'How to compose the first frame: character_focus (closeup), environment_focus (wide), two_shot, group, detail_insert';

-- ============================================================================
-- Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_shots_transition_type
  ON public.shots(transition_type)
  WHERE transition_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shots_continuation_from
  ON public.shots(continuation_from_shot_id)
  WHERE continuation_from_shot_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shots_frame_strategy
  ON public.shots(frame_strategy)
  WHERE frame_strategy IS NOT NULL;
