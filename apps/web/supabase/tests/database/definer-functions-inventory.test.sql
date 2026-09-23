begin;

-- KB-27: every SECURITY DEFINER function a signed-in user can call.
--
-- Row-level security does not apply inside a SECURITY DEFINER function, and
-- PostgREST exposes every function `authenticated` can execute as
-- POST /rest/v1/rpc/<name>. So each one below is a door past RLS, and its
-- access check is the only thing standing in it. KB-27 (commit_canon_changes)
-- and KB-11 were that door with no check, or a check re-derived by hand.
--
-- I1 pins the list. Adding, granting or overloading a definer function in
-- `public` or `kit` fails this test until the function is added below WITH
-- ITS ACCESS CHECK in the comment. Review the check; do not just append.
--
-- Merge order: this list is exact as of KB-27 (after KB-18 and KB-28). A PR
-- that merges after it and adds a definer function adds one line here; one
-- that revokes a function removes its line (FILM-607 revoked, then dropped,
-- the Edit Suite's assemble function, closing KB-40).
--
-- I2: none of them may run without a pinned search_path.

select plan(2);

select results_eq(
  $$ select (n.nspname::text || '.' || p.proname::text) collate "default" as fn
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('public', 'kit')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      order by 1 $$,
  $$ select fn from (values
       -- returns the project id of a storage path; ids only (KB-28)
       ('kit.get_project_id_from_path'),
       -- project_members owner/admin/member of the episode's project
       ('public.batch_create_shots'),
       -- every episode in p_account_id and can_write_project(its project) (KB-27)
       ('public.bulk_reset_episodes_to_stage'),
       -- predicate about the caller
       ('public.can_edit_project'),
       -- predicate about the caller: the project-write rule (KB-28)
       ('public.can_write_project'),
       -- can_write_project of the path's project (KB-28)
       ('public.can_write_project_storage'),
       -- NONE: any account's budget status: KB-42, open
       ('public.check_account_budget'),
       -- episode in the project and can_write_project (KB-27)
       ('public.commit_canon_changes'),
       -- project_members owner/admin/member
       ('public.create_character_with_details'),
       -- personal owner or has_role_on_account
       ('public.get_account_projects'),
       -- predicate about the caller
       ('public.get_current_account_id'),
       -- project_members, any role
       ('public.get_project_generation_costs'),
       -- access to the project's account (KB-41, #319)
       ('public.get_project_members'),
       -- predicate about the caller
       ('public.has_account_access'),
       -- predicate about the caller
       ('public.has_role_on_account'),
       -- system template, or owner/role on its account
       ('public.increment_template_usage'),
       -- predicate about the caller
       ('public.is_mfa_compliant'),
       -- predicate about the caller
       ('public.is_project_owner'),
       -- requires the caller's own membership of the account
       ('public.is_team_member'),
       -- can_edit_project (project owner/admin) of the fact's project (KB-18)
       ('public.set_fact_verification'),
       -- project_members owner/admin
       ('public.soft_delete_episode'),
       -- project_members owner/admin/member
       ('public.update_episode_with_lock'),
       -- can_write_project (KB-28)
       ('public.update_project_cover_image'),
       -- predicate about the caller
       ('public.user_owns_account'),
       -- the token is the credential (Makerkit)
       ('public.verify_nonce')
     ) v(fn) order by fn $$,
  'I1: the SECURITY DEFINER functions authenticated can execute are exactly the reviewed list'
);

select is_empty(
  $$ select n.nspname::text || '.' || p.proname::text
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where p.prosecdef
        and n.nspname in ('public', 'kit')
        and has_function_privilege('authenticated', p.oid, 'EXECUTE')
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%') $$,
  'I2: every one of them pins its search_path'
);

select * from finish();

rollback;
