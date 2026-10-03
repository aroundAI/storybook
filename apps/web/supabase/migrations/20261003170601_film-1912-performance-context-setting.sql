-- FILM-1912: a team chooses whether generation briefs for ideation, story
-- and shots carry a performance_context block (what worked in the team's
-- earlier episodes). Off by default: past performance steers the model,
-- so a team opts in. A team with no account_ai_settings row is off.
--
-- The table's policies already decide who may change it (owners write,
-- members read), and its account_id FK is covered by the team-only rule.
-- Tests: tests/database/performance-context-setting.test.sql.

alter table public.account_ai_settings
  add column performance_context_enabled boolean not null default false;

comment on column public.account_ai_settings.performance_context_enabled is
  'Whether briefs for ideation, story and shots carry past-episode performance (FILM-1912). Off by default; owners change it (UI: FILM-1910)';
