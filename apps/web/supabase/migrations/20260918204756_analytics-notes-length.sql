-- ==================================
-- Bound the analytics notes in the table (FILM-1610 review)
-- ==================================
-- Both notes are capped at 5,000 characters by zod, but PostgREST is
-- reachable without going through the action, so the table enforces the
-- same bound. Both columns were added by FILM-1610 and hold no rows longer
-- than the zod limit, so these constraints validate immediately.

alter table public.publishes
  add constraint publishes_analytics_note_length_check
  check (char_length(analytics_note) <= 5000);

alter table public.analytics_experiments
  add constraint analytics_experiments_notes_length_check
  check (char_length(notes) <= 5000);
