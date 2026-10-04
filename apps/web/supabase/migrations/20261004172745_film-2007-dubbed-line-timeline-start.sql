-- FILM-2007: a dubbed line carries where it sits on the episode's timeline.
--
-- localize_episode voices each dialogue line again in another language
-- (per-line TTS, the lead default for README open question 6). The dub is
-- placed where its source line starts; the voice worker copies the source
-- line's timeline_start_seconds onto the dubbed row when it writes it, so a
-- dub keeps the position it was made for even if the source line later
-- moves. Null when the source line had no position. Never negative, as
-- dialogue_lines' own column.

alter table public.dubbed_dialogue_lines
  add column if not exists timeline_start_seconds decimal(10, 2);

alter table public.dubbed_dialogue_lines
  add constraint dubbed_dialogue_lines_timeline_start_nonnegative
  check (timeline_start_seconds is null or timeline_start_seconds >= 0);

comment on column public.dubbed_dialogue_lines.timeline_start_seconds is
  'Where the dub starts on the episode timeline, in seconds: the source line''s timeline_start_seconds when it was voiced (FILM-2007). Null when the source line had none.';
