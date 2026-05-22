-- Migrate projects.metadata.recurringElement (single object) → recurringElements (array)
-- This is a non-destructive migration: converts the old format to new format
-- and removes the old key in a single atomic update.

UPDATE public.projects
SET metadata = jsonb_set(
  metadata - 'recurringElement',
  '{recurringElements}',
  jsonb_build_array(
    metadata->'recurringElement' || jsonb_build_object(
      'id', gen_random_uuid()::text,
      'name', 'Recurring Element'
    )
  )
)
WHERE metadata ? 'recurringElement'
  AND NOT metadata ? 'recurringElements'
  AND metadata->'recurringElement' IS NOT NULL
  AND jsonb_typeof(metadata->'recurringElement') = 'object';
