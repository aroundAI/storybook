/*
 * KB-17: immutable_events are immutable.
 *
 * An immutable event is canon the continuity validator treats as fixed. Until
 * now the table had one policy, FOR ALL on has_role_on_account with no WITH
 * CHECK, and every table privilege granted to anon and authenticated. Measured
 * over PostgREST as real users (FILM-CC-04 KB-17): a project member rewrote an
 * owner's event and re-pointed its author; members, project viewers and team
 * members not on the project could all rewrite, delete and insert canon, and
 * insert it in a colleague's name; a personal-account owner could neither read
 * nor add canon in their own project.
 *
 * The owner's rules (2026-09-23):
 *   read    account membership: has_account_access (covers personal owners)
 *   insert  the project-write rule, can_write_project (KB-28), as yourself,
 *           established in an episode of the same project
 *   delete  can_write_project (D1). Every reset path already deletes canon
 *           for a writer: the single-episode resets, bulk reset (KB-27) and
 *           story regeneration.
 *   update  nobody, by any role (D3). A wrong event is deleted and re-added,
 *           and the new one names whoever added it.
 *
 * SECURITY DEFINER writers are not bound by these policies:
 * commit_canon_changes (KB-27) checks can_write_project and authors events as
 * its caller itself; bulk_reset_episodes_to_stage deletes as a writer. Neither
 * updates the table. The trigger below binds every role, them included.
 *
 * Tests: tests/database/immutable-events-immutable.test.sql, and KB-1's
 * audit-author-snapshot / authors-deletable for the user-deletion exception.
 */

-- ------------------------------------------------------------------
-- Policies: one per verb
-- ------------------------------------------------------------------
drop policy if exists "immutable_events_project_access" on public.immutable_events;
drop policy if exists "immutable_events_read" on public.immutable_events;
drop policy if exists "immutable_events_insert" on public.immutable_events;
drop policy if exists "immutable_events_delete" on public.immutable_events;

create policy "immutable_events_read" on public.immutable_events
  for select to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = immutable_events.project_id
        and public.has_account_access(p.account_id)
    )
  );

create policy "immutable_events_insert" on public.immutable_events
  for insert to authenticated with check (
    created_by = (select auth.uid())
    and public.can_write_project(project_id)
    and exists (
      select 1 from public.episodes e
      where e.id = immutable_events.established_in
        and e.project_id = immutable_events.project_id
    )
  );

create policy "immutable_events_delete" on public.immutable_events
  for delete to authenticated using (
    public.can_write_project(project_id)
  );

-- No UPDATE policy, and no UPDATE privilege: a PATCH through PostgREST is
-- refused with 42501 instead of silently matching no rows.

-- ------------------------------------------------------------------
-- Privileges
-- ------------------------------------------------------------------
revoke all on table public.immutable_events from anon, authenticated;
grant select, insert, delete on table public.immutable_events to authenticated;

-- ------------------------------------------------------------------
-- Write-once, for every role
-- ------------------------------------------------------------------
-- The one update allowed is the auth.users foreign key clearing a deleted
-- author (ON DELETE SET NULL, KB-1): it arrives from inside that key's
-- trigger (depth 2, measured) and changes nothing but created_by. KB-1's
-- snapshot trigger then keeps created_by_name. Anything else -- a rewrite,
-- a re-attribution, clearing the author by hand, or a nested update that
-- clears the author AND changes something -- is refused.
--
-- A future backfill that has to rewrite events must disable this trigger
-- inside its own migration, as 20260921211043 disabled user triggers. That
-- friction is deliberate.
create or replace function public.immutable_events_refuse_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1
     and old.created_by is not null
     and new.created_by is null
     and (to_jsonb(new) - 'created_by') = (to_jsonb(old) - 'created_by') then
    return new;
  end if;

  raise exception 'immutable_events rows cannot be changed'
    using errcode = '42501',
          hint = 'Delete the event and add a corrected one; the new one is authored by whoever adds it.';
end;
$$;

comment on function public.immutable_events_refuse_update() is
  'KB-17: refuses every UPDATE of immutable_events, for every role, except the auth.users foreign key clearing a deleted author and changing nothing else.';

-- Named to sort before immutable_events_snapshot_creator_name: BEFORE
-- triggers fire in name order, so this sees the row as the caller wrote it.
drop trigger if exists immutable_events_refuse_update on public.immutable_events;
create trigger immutable_events_refuse_update
  before update on public.immutable_events
  for each row execute function public.immutable_events_refuse_update();

revoke all on function public.immutable_events_refuse_update() from public, anon, authenticated;
