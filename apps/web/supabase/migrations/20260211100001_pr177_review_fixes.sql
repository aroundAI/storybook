-- PR #177 Review Fixes
-- (1) Fix parent_final_character_states default from '{}' to '[]' (array type)
-- (2) Add parent_project_name column for caching

-- Fix default value: should be JSON array, not JSON object
alter table public.sequel_parent_contexts
  alter column parent_final_character_states set default '[]';

-- Add parent_project_name column for complete cache
alter table public.sequel_parent_contexts
  add column if not exists parent_project_name text not null default '';
