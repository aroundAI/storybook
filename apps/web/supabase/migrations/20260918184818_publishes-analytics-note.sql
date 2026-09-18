-- ==================================
-- Per-video analytics note on publishes (FILM-1610)
-- ==================================
-- A dedicated column rather than a key in `publishes.metadata`: metadata is
-- shared jsonb the publish pipeline writes, and an analytics read-modify-write
-- on it races a concurrent publish and can drop platform fields with no error.
--
-- `publishes` has no `updated_at`, so the note carries its own timestamp and
-- author. Nullable, with no default: adding them is metadata-only in
-- Postgres, so the table is not rewritten and no existing writer sees a new
-- NOT NULL. The author reference nulls on user deletion, so writing a note
-- never blocks deleting the account that wrote it.
--
-- No new policy. The existing `publishes_update` policy governs who may write
-- a note: owner, admin or member of the publish's project. An account member
-- who is not on the project can read the note but not change it — the same
-- rule as editing the publish. `publish-analytics-note-rls.test.sql` proves it.

alter table public.publishes
  add column if not exists analytics_note text,
  add column if not exists analytics_note_updated_at timestamptz,
  add column if not exists analytics_note_updated_by uuid
    references auth.users(id) on delete set null;

comment on column public.publishes.analytics_note is 'Free-text analytics note for this video; never synced to ClickHouse';
