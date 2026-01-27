-- Drop source_shot_id column from publishes table as it is replaced by metadata.shortsGroupId
ALTER TABLE public.publishes DROP COLUMN IF EXISTS source_shot_id;
