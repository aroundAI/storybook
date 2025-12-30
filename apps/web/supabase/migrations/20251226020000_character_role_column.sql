-- Migration: Add role column to character_details for proper sorting
-- Characters sorted: Protagonist > Deuteragonist > Supporting > Creature > Object > Background

-- Add role column with default 'supporting'
ALTER TABLE public.character_details 
ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'supporting';

-- Add check constraint for valid roles
ALTER TABLE public.character_details 
ADD CONSTRAINT character_role_check 
CHECK (role IN ('protagonist', 'deuteragonist', 'supporting', 'creature', 'object', 'background', 'narrator'));

-- Create index for role-based sorting
CREATE INDEX IF NOT EXISTS idx_character_details_role ON public.character_details(role);

-- Backfill existing characters by parsing description prefix from assets table
-- Format: "Role - Description..." where Role can be Protagonist, Creature, etc.
UPDATE public.character_details cd
SET role = CASE 
    WHEN LOWER(a.description) LIKE 'protagonist -%' THEN 'protagonist'
    WHEN LOWER(a.description) LIKE 'protagonist:%' THEN 'protagonist'
    WHEN LOWER(a.description) LIKE 'deuteragonist -%' THEN 'deuteragonist'
    WHEN LOWER(a.description) LIKE 'deuteragonist:%' THEN 'deuteragonist'
    WHEN LOWER(a.description) LIKE 'supporting -%' THEN 'supporting'
    WHEN LOWER(a.description) LIKE 'supporting:%' THEN 'supporting'
    WHEN LOWER(a.description) LIKE 'creature -%' THEN 'creature'
    WHEN LOWER(a.description) LIKE 'creature:%' THEN 'creature'
    WHEN LOWER(a.description) LIKE 'object -%' THEN 'object'
    WHEN LOWER(a.description) LIKE 'object:%' THEN 'object'
    WHEN LOWER(a.description) LIKE 'background -%' THEN 'background'
    WHEN LOWER(a.description) LIKE 'background:%' THEN 'background'
    WHEN LOWER(a.description) LIKE 'narrator -%' THEN 'narrator'
    WHEN LOWER(a.description) LIKE 'narrator:%' THEN 'narrator'
    ELSE 'supporting'
END
FROM public.assets a
WHERE a.id = cd.asset_id
  AND a.type = 'character'
  AND cd.role IS NULL OR cd.role = 'supporting';

-- Comment
COMMENT ON COLUMN public.character_details.role IS 'Character role for sorting: protagonist, deuteragonist, supporting, creature, object, background, narrator';
