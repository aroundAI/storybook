-- Migration: Drop deprecated localized_shorts column
-- The shorts functionality now uses shorts_groups (JSONB array) exclusively

ALTER TABLE episodes DROP COLUMN IF EXISTS localized_shorts;
