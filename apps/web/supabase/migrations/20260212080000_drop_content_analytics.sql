-- Migration: Drop content_analytics table
-- FILM-1201: Analytics metrics now stored in ClickHouse (video_daily_stats table).
-- Revenue data remains in revenue_records table (Postgres).
-- This migration removes the Postgres content_analytics table that is no longer
-- used by any query or ingestion path.

-- Drop RLS policies first
drop policy if exists "content_analytics_read" on public.content_analytics;
drop policy if exists "content_analytics_create" on public.content_analytics;
drop policy if exists "content_analytics_update" on public.content_analytics;

-- Drop indexes
drop index if exists idx_content_analytics_publish_id;
drop index if exists idx_content_analytics_snapshot_date;
drop index if exists idx_content_analytics_publish_date;
drop index if exists idx_content_analytics_views;

-- Drop table
drop table if exists public.content_analytics;
