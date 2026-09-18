-- ==================================
-- Experiment integrity the table enforces itself (FILM-1610 review, round 2)
-- ==================================
-- Everything here was either enforced only in a server action, or not at
-- all. PostgREST is reachable directly by any authenticated client, so each
-- rule has to hold without the action in the way.

-- ----------------------------------
-- R3: replacing an experiment's links is one transaction
-- ----------------------------------
-- The action deleted the links and then inserted the new ones as two
-- requests, so a refused insert left the experiment with no videos at all.
-- One function call is one transaction: the insert failing rolls the delete
-- back. `security invoker`, so every policy on experiment_publishes —
-- including the same-account check — still applies to the caller.

create or replace function public.replace_experiment_publishes(
  p_experiment_id uuid,
  p_publish_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.experiment_publishes
   where experiment_id = p_experiment_id;

  insert into public.experiment_publishes (experiment_id, publish_id)
  select p_experiment_id, publish_id
    from (select distinct unnest(p_publish_ids) as publish_id) ids;
end;
$$;

create or replace function public.replace_experiment_tags(
  p_experiment_id uuid,
  p_tag_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.experiment_tags
   where experiment_id = p_experiment_id;

  insert into public.experiment_tags (experiment_id, tag_id)
  select p_experiment_id, tag_id
    from (select distinct unnest(p_tag_ids) as tag_id) ids;
end;
$$;

grant execute on function public.replace_experiment_publishes(uuid, uuid[]) to authenticated;
grant execute on function public.replace_experiment_tags(uuid, uuid[]) to authenticated;

-- ----------------------------------
-- R5: once started, what the baseline measured is frozen
-- ----------------------------------
-- The baseline was measured over the watched metric, the review window and
-- the linked videos; changing any of them afterwards compares a baseline of
-- one thing with a result of another.

create or replace function public.freeze_started_experiment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'planned'
     and (new.metric_watched is distinct from old.metric_watched
          or new.review_window_days is distinct from old.review_window_days) then
    raise exception
      'The watched metric and review window cannot change once an experiment has started';
  end if;

  return new;
end;
$$;

create trigger analytics_experiments_freeze_started
  before update of metric_watched, review_window_days on public.analytics_experiments
  for each row execute function public.freeze_started_experiment();

-- Linked videos: only a planned experiment's links can be added or removed.
-- A cascade from deleting the experiment is unaffected: foreign-key actions
-- do not go through RLS.
drop policy "experiment_publishes_create" on public.experiment_publishes;

create policy "experiment_publishes_create" on public.experiment_publishes for insert
  to authenticated with check (
    exists (
      select 1
        from public.analytics_experiments e
        join public.publishes pub on pub.id = experiment_publishes.publish_id
        join public.episodes ep on ep.id = pub.episode_id
        join public.projects p on p.id = ep.project_id
       where e.id = experiment_publishes.experiment_id
         and public.has_account_access(e.account_id)
         and p.account_id = e.account_id
         and e.status = 'planned'
    )
  );

drop policy "experiment_publishes_delete" on public.experiment_publishes;

create policy "experiment_publishes_delete" on public.experiment_publishes for delete
  to authenticated using (
    exists (
      select 1 from public.analytics_experiments e
       where e.id = experiment_id
         and public.has_account_access(e.account_id)
         and e.status = 'planned'
    )
  );

-- ----------------------------------
-- R4: audit fields are the database's, not the caller's
-- ----------------------------------
-- The note's author and time were sent by the client, so a direct update
-- could record any user at any time. They are now set here when the note
-- changes, and kept as they were when it does not. The trigger fires only
-- for updates that name these columns, so the publish pipeline's writes to
-- `publishes` never reach it.

create or replace function public.set_analytics_note_audit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- A foreign-key action (deleting the author nulls analytics_note_updated_by)
  -- runs inside the constraint's own trigger, so it arrives here nested.
  -- Restoring the old author would re-point the row at the user being
  -- deleted and fail the delete; let the cascade through.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.analytics_note is distinct from old.analytics_note then
    new.analytics_note_updated_at = now();
    new.analytics_note_updated_by = auth.uid();
  else
    new.analytics_note_updated_at = old.analytics_note_updated_at;
    new.analytics_note_updated_by = old.analytics_note_updated_by;
  end if;

  return new;
end;
$$;

create trigger publishes_analytics_note_audit
  before update of analytics_note, analytics_note_updated_at, analytics_note_updated_by
  on public.publishes
  for each row execute function public.set_analytics_note_audit();

-- An experiment's creator is whoever inserts it. A service-role insert has no
-- auth.uid(), so it keeps what it wrote (seeds and backfills).
create or replace function public.set_experiment_creator()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.created_by = auth.uid();
  end if;

  return new;
end;
$$;

create trigger analytics_experiments_set_creator
  before insert on public.analytics_experiments
  for each row execute function public.set_experiment_creator();

-- ----------------------------------
-- R11: which of these publishes may the caller edit?
-- ----------------------------------
-- The `publishes_update` condition, as a function the Video Log can call
-- instead of restating the role list in TypeScript. It is still a second
-- statement of the rule, so experiments-integrity.test.sql checks it
-- against an actual update for each kind of user.

create or replace function public.editable_publish_ids(p_publish_ids uuid[])
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select pub.id
    from public.publishes pub
    join public.episodes e on e.id = pub.episode_id
   where pub.id = any(p_publish_ids)
     and exists (
       select 1 from public.project_members pm
        where pm.project_id = e.project_id
          and pm.user_id = auth.uid()
          and pm.role in ('owner', 'admin', 'member')
     );
$$;

grant execute on function public.editable_publish_ids(uuid[]) to authenticated;
