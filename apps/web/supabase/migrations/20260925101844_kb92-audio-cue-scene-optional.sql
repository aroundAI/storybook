/*
 * KB-92: a cue takes its scene from the shot it starts on, and a shot's scene
 * is optional by design (shots.scene_number is nullable, 20251209061319).
 * NOT NULL here made one sceneless shot fail the whole episode's cue insert,
 * which is one statement. A cue on a sceneless shot now has no scene.
 */
alter table public.audio_cues alter column scene_number drop not null;

comment on column public.audio_cues.scene_number is
  'Scene of the shot the cue starts on; null when that shot has no scene number (KB-92)';
