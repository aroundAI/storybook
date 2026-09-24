-- KB-78: regenerating a story deleted canon that was added by hand.
--
-- Story generation clears an episode's canon before writing the new
-- extraction (llm-worker `commit-story-canon.ts`). Generated events and
-- character states carry a marker (`metadata.auto_generated`,
-- `trigger_event = 'story_generation'`), so the clear can spare the rest.
-- A thread did not: one the lambda opened and one a writer committed on the
-- Publish page are identical row for row. This column is that marker.
--
-- Only the llm-worker sets it. Every other writer omits it, and the default
-- keeps their threads out of the clear. Threads from before this migration
-- cannot be told apart, so they are all `false` — kept — whatever their
-- origin; the cost is at most one duplicate thread when an old episode is
-- regenerated.
--
-- Adding a column with a constant default rewrites no rows (PostgreSQL 11+).

alter table public.narrative_threads
  add column auto_generated boolean not null default false;

comment on column public.narrative_threads.auto_generated is
  'True when story generation opened the thread; regenerating the story replaces only these (KB-78). Rows created before 2026-09-24 are false whatever their origin.';
