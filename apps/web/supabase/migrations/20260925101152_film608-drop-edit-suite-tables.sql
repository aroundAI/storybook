-- ==================================
-- FILM-608: drop the retired Edit Suite tables
-- ==================================
-- FILM-607 retired the Edit Suite and kept its six tables read-only under
-- keep-until-asked (KB-20). No code reads or writes them. This removes them,
-- and the one column elsewhere that points into them.
--
-- Owner decision, 2026-09-25: discard, owner-approved, no export. The owner
-- read production with FILM-608's row-count query: edit_projects 1,
-- edit_tracks 2, edit_clips 11, edit_keyframes 11, edit_transitions 0,
-- dialogue_sync_groups 0; edit_projects with render_status <> 'none' 0;
-- compilations with edit_project_id set 0. Recorded in FILM-608's first
-- acceptance criterion too.
--
-- Guarded, like Hook Lab (20260919193447_remove-hook-lab.sql). `acknowledged`
-- holds the rows the owner has read and exported or chosen to discard, per
-- table. If any table holds more than that, the migration stops before
-- dropping anything, names every count, and nothing is lost. Since FILM-607
-- no code writes these tables and neither anon nor authenticated may, so a
-- count above what the owner read means a database nobody has inspected.

do $$
declare
  acknowledged constant jsonb := '{
    "edit_projects": 1,
    "edit_tracks": 2,
    "edit_clips": 11,
    "edit_keyframes": 11,
    "edit_transitions": 0,
    "dialogue_sync_groups": 0
  }';
  t text;
  n bigint;
  counts text[] := '{}';
  refuse boolean := false;
begin
  foreach t in array array[
    'edit_projects',
    'edit_tracks',
    'edit_clips',
    'edit_keyframes',
    'edit_transitions',
    'dialogue_sync_groups'
  ]
  loop
    execute format('select count(*) from public.%I', t) into n;
    counts := counts || format('%s=%s', t, n);
    refuse := refuse or n > coalesce((acknowledged ->> t)::bigint, 0);
  end loop;

  if refuse then
    raise exception
      'FILM-608: the retired Edit Suite tables hold rows nobody acknowledged (%). Not dropping them: export or discard, record the decision in FILM-608, and set the acknowledged counts.',
      array_to_string(counts, ', ');
  end if;
end;
$$;

-- The only reference into the Edit Suite from a surviving table.
alter table public.compilations drop column edit_project_id;

-- One statement, so the edit_clips <-> dialogue_sync_groups foreign keys
-- resolve together. No cascade: any other dependent object stops the drop.
-- Policies, grants, indexes, triggers and constraints go with each table.
drop table
  public.edit_keyframes,
  public.edit_transitions,
  public.edit_clips,
  public.dialogue_sync_groups,
  public.edit_tracks,
  public.edit_projects;
