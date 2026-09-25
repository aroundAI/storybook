-- ==================================
-- KB-113: the rest of "a row names another account's object and nothing
-- checks it" — tasks, Change log projects, and moving rows between accounts
-- ==================================
-- Follows 20260925120329 (KB-98, #387), with the same kind of helper and
-- the same freeze trigger. Reproduced through RLS on 2026-09-25 on main
-- plus #387, as a user who owns team A and is also a member of team T;
-- each of these succeeded:
--
--   manual_tasks            insert or update naming T's publish or episode
--   analytics_experiments   insert or update naming T's project
--   projects                account_id moved A -> T (the whole project, its
--                           episodes, publishes and their links with it)
--   analytics_experiments   account_id moved A -> T, stranding its tag and
--                           video links in A
--   episodes                project_id moved to T's project
--   publishes               episode_id moved to T's episode
--
-- A user outside the target account cannot move a project there: Postgres
-- applies projects_read to the updated row, and it requires access to the
-- new account. Only someone in both accounts can, which is who KB-98's
-- rules were written for.
--
-- Nothing in the app writes projects.account_id,
-- analytics_experiments.account_id, episodes.project_id or
-- publishes.episode_id after insert. Moving an episode or publish within one
-- account stays allowed. Every change narrows; USING clauses are unchanged.
-- Owner rule (2026-09-25): migrations may be written; production is
-- migrated by the owner.

-- ----------------------------------
-- Helpers: the same shape as connection_in_account and tag_in_account
-- ----------------------------------
-- SECURITY DEFINER for the same reason: whether a row belongs to an
-- account is a fact about two rows, the same for every caller, and must not
-- depend on the read policies of the tables it walks.

create or replace function public.project_in_account(project_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select project_in_account.project_id is null
      or exists (
           select 1 from public.projects p
            where p.id = project_in_account.project_id
              and p.account_id = project_in_account.account_id
         );
$$;

create or replace function public.episode_in_account(episode_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select episode_in_account.episode_id is null
      or exists (
           select 1
             from public.episodes e
             join public.projects p on p.id = e.project_id
            where e.id = episode_in_account.episode_id
              and p.account_id = episode_in_account.account_id
         );
$$;

create or replace function public.publish_in_account(publish_id uuid, account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select publish_in_account.publish_id is null
      or exists (
           select 1
             from public.publishes pub
             join public.episodes e on e.id = pub.episode_id
             join public.projects p on p.id = e.project_id
            where pub.id = publish_in_account.publish_id
              and p.account_id = publish_in_account.account_id
         );
$$;

comment on function public.project_in_account(uuid, uuid) is
  'True when the project is null or belongs to the account (KB-113).';
comment on function public.episode_in_account(uuid, uuid) is
  'True when the episode is null or its project belongs to the account (KB-113).';
comment on function public.publish_in_account(uuid, uuid) is
  'True when the publish is null or its episode''s project belongs to the account (KB-113).';

revoke all on function public.project_in_account(uuid, uuid) from public, anon;
revoke all on function public.episode_in_account(uuid, uuid) from public, anon;
revoke all on function public.publish_in_account(uuid, uuid) from public, anon;
grant execute on function public.project_in_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.episode_in_account(uuid, uuid) to authenticated, service_role;
grant execute on function public.publish_in_account(uuid, uuid) to authenticated, service_role;

-- ----------------------------------
-- Clean what the old policies let through
-- ----------------------------------
-- The columns are nullable and nothing reads them across accounts, so a
-- foreign reference is cleared rather than the row deleted. An experiment
-- moved to another account left its video links behind; those links are
-- deleted, as KB-98 deleted cross-account tag links.

do $$
declare
  n integer;
begin
  update public.manual_tasks t
     set publish_id = null
   where t.publish_id is not null
     and not public.publish_in_account(t.publish_id, t.account_id);
  get diagnostics n = row_count;
  raise notice 'KB-113: cleared publish_id on % manual_tasks naming another account''s publish', n;

  update public.manual_tasks t
     set episode_id = null
   where t.episode_id is not null
     and not public.episode_in_account(t.episode_id, t.account_id);
  get diagnostics n = row_count;
  raise notice 'KB-113: cleared episode_id on % manual_tasks naming another account''s episode', n;

  update public.analytics_experiments x
     set project_id = null
   where x.project_id is not null
     and not public.project_in_account(x.project_id, x.account_id);
  get diagnostics n = row_count;
  raise notice 'KB-113: cleared project_id on % analytics_experiments naming another account''s project', n;

  delete from public.experiment_publishes ep
   using public.analytics_experiments x
   where x.id = ep.experiment_id
     and not public.publish_in_account(ep.publish_id, x.account_id);
  get diagnostics n = row_count;
  raise notice 'KB-113: deleted % experiment_publishes linking another account''s video', n;
end;
$$;

-- ----------------------------------
-- The policies: USING unchanged, WITH CHECK adds the helpers
-- ----------------------------------

alter policy "manual_tasks_create" on public.manual_tasks with check (
  public.has_account_access(account_id)
  and public.publish_in_account(publish_id, account_id)
  and public.episode_in_account(episode_id, account_id)
);

-- manual_tasks_update had no WITH CHECK, so its USING — the account only —
-- was the check on the new row.
alter policy "manual_tasks_update" on public.manual_tasks with check (
  public.has_account_access(account_id)
  and public.publish_in_account(publish_id, account_id)
  and public.episode_in_account(episode_id, account_id)
);

alter policy "analytics_experiments_create" on public.analytics_experiments with check (
  public.has_account_access(account_id)
  and public.project_in_account(project_id, account_id)
);

alter policy "analytics_experiments_update" on public.analytics_experiments with check (
  public.has_account_access(account_id)
  and public.project_in_account(project_id, account_id)
);

-- ----------------------------------
-- A project or a Change log entry stays in its account
-- ----------------------------------
-- keep_account_id is KB-98's: signed-in callers only, errcode 42501.

create trigger projects_keep_account
  before update of account_id on public.projects
  for each row execute function public.keep_account_id('project');

create trigger analytics_experiments_keep_account
  before update of account_id on public.analytics_experiments
  for each row execute function public.keep_account_id('change');

-- ----------------------------------
-- An episode or publish moves only within its account
-- ----------------------------------

create or replace function public.keep_episode_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.project_id is distinct from old.project_id
     and not public.project_in_account(
           new.project_id,
           (select p.account_id from public.projects p where p.id = old.project_id)
         ) then
    raise exception 'An episode cannot move to another account''s project'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create or replace function public.keep_publish_account()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and new.episode_id is distinct from old.episode_id
     and not public.episode_in_account(
           new.episode_id,
           (select p.account_id
              from public.episodes e
              join public.projects p on p.id = e.project_id
             where e.id = old.episode_id)
         ) then
    raise exception 'A publish cannot move to another account''s episode'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger episodes_keep_account
  before update of project_id on public.episodes
  for each row execute function public.keep_episode_account();

create trigger publishes_keep_account
  before update of episode_id on public.publishes
  for each row execute function public.keep_publish_account();
