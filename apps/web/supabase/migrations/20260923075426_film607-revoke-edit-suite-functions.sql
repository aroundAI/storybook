-- ==================================
-- FILM-607 stop-gap: the Edit Suite is retired
-- ==================================
-- The owner retired the Edit Suite on 2026-09-23. This migration closes
-- KB-40: batch_assemble_edit_project is SECURITY DEFINER, granted to
-- authenticated, and trusts a caller-supplied p_user_id, so any signed-in
-- user could delete and replace any episode's edit project.
--
-- Every Edit Suite function loses EXECUTE for the API roles. The other four
-- were never granted (KB-62); they are revoked too, so a grant added by hand
-- anywhere is closed as well. The loop covers every overload. service_role
-- keeps EXECUTE: nothing calls these functions, and the full removal
-- (FILM-607 part B) drops them.

do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'batch_assemble_edit_project',
        'batch_save_edit_project',
        'create_edit_project_with_tracks',
        'split_edit_clip',
        'get_project_id_for_edit_project'
      )
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      f
    );
  end loop;
end;
$$;
