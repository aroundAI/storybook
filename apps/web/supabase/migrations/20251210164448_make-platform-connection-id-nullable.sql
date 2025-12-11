-- Migration: Make platform_connection_id nullable in publishes table
-- Purpose: Allow external/manual uploads that don't use OAuth connections
-- Ticket: FILM-713 (Upload-Only Mode)

ALTER TABLE public.publishes
ALTER COLUMN platform_connection_id DROP NOT NULL;

COMMENT ON COLUMN public.publishes.platform_connection_id IS 'Optional FK to platform_connections. NULL for external/manual uploads.';
