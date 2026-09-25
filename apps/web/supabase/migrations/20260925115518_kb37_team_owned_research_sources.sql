-- KB-37: research sources belong to a team, not to one list every team edits.
--
-- Before: `external_sources` rows with no project were one platform-wide
-- registry. Any "owner of any account" could add, edit or deactivate them,
-- and any signed-in user becomes one with a single `create_team_account`
-- call. Writes went through the admin client, so nothing in the database
-- stopped it, and a bare `sourceId` also reached other projects' sources.
--
-- After this migration, every row is exactly one of:
--   * built-in (`is_builtin`): the seeded platform catalogue, the only rows
--     the news aggregator searches. Readable by every signed-in user, and
--     writable by nobody through the API (migrations only);
--   * a team source (`account_id` set, no project): read by the team's
--     members, written by its owners;
--   * a project source (`project_id` set, `account_id` its project's team):
--     read and written by the project's owner/admin/member rows
--     (`can_write_project`, KB-28), as KB-26 made uploads;
--   * an orphan (no team, no project, not built-in): a source added through
--     the hub before this fix. Its owner was never recorded, so it is readable
--     and writable by nobody until an operator attaches it to a team or
--     project (runbook in the KB-37 PR), as KB-26 did for pre-fix uploads.
--
-- It runs directly after KB-26's migration in production, on a table where
-- every row has `project_id` null: the backfill below handles zero project
-- rows, and only the 12 seeded slugs become built-ins.

-- =============================================================================
-- Columns
-- =============================================================================

alter table public.external_sources
  add column account_id uuid references public.accounts (id) on delete cascade,
  add column is_builtin boolean not null default false;

-- The catalogue seeded by 20260211200003_seed_news_sources.sql. Nothing else
-- is a built-in: a shared row with any other slug was added by a user.
update public.external_sources
set is_builtin = true
where project_id is null
  and slug in (
    'reuters', 'ap-news', 'afp', 'bbc-news', 'nytimes', 'guardian',
    'wsj', 'aljazeera', 'cnn', 'npr', 'fox-news', 'daily-telegraph'
  );

-- KB-26's project rows take their project's team.
update public.external_sources s
set account_id = p.account_id
from public.projects p
where p.id = s.project_id;

alter table public.external_sources
  add constraint external_sources_builtin_unowned
    check (not is_builtin or (account_id is null and project_id is null)),
  add constraint external_sources_project_has_team
    check (project_id is null or account_id is not null);

-- A project row's team is its project's team: filled in when omitted,
-- refused when it disagrees. Definer, so the lookup does not depend on the
-- caller's view of `projects`.
create or replace function kit.external_sources_project_team ()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare
  v_account_id uuid;
begin
  if new.project_id is null then
    return new;
  end if;

  select p.account_id into v_account_id
  from public.projects p
  where p.id = new.project_id;

  if new.account_id is null then
    new.account_id := v_account_id;
  elsif new.account_id is distinct from v_account_id then
    raise exception 'external_sources: a project source belongs to its project''s team'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function kit.external_sources_project_team () from public;

create trigger external_sources_project_team
  before insert or update of project_id, account_id
  on public.external_sources
  for each row
  execute function kit.external_sources_project_team ();

-- =============================================================================
-- Slugs: unique per owner
-- =============================================================================

-- Two teams may each have "Notes"; a team may have its own "Reuters" beside
-- the built-in one. Built-ins and orphans (no team, no project) share one
-- scope, so a built-in slug stays unique. Upserts target
-- `(account_id, project_id, slug)`.
alter table public.external_sources
  drop constraint external_sources_project_slug_key;

alter table public.external_sources
  add constraint external_sources_owner_slug_key
  unique nulls not distinct (account_id, project_id, slug);

create index idx_external_sources_account
  on public.external_sources (account_id)
  where account_id is not null and project_id is null;

-- =============================================================================
-- RLS
-- =============================================================================

drop policy external_sources_read on public.external_sources;

-- A team's or project's own rows stay readable to it when deactivated: an
-- `update … returning`, which is how PostgREST writes, must see the new row,
-- so hiding inactive rows here would make deactivating one fail. The hub
-- lists active rows only. An inactive built-in is hidden from everyone.
create policy external_sources_read on public.external_sources
  for select to authenticated
  using (
    (is_builtin and is_active)
    or (project_id is null and account_id is not null
        and public.has_role_on_account(account_id))
    or (project_id is not null and public.can_write_project(project_id))
  );

-- Writes by signed-in users, so the actions can use the user's own client
-- and this is the rule, not a check before an admin write. Built-ins and
-- orphans match neither branch. There is no delete policy: a source is
-- deactivated (`is_active = false`), which is an update.
create policy external_sources_insert on public.external_sources
  for insert to authenticated
  with check (
    not is_builtin
    and account_id is not null
    and (
      (project_id is null and public.has_role_on_account(account_id, 'owner'))
      or (project_id is not null and public.can_write_project(project_id))
    )
  );

create policy external_sources_update on public.external_sources
  for update to authenticated
  using (
    not is_builtin
    and account_id is not null
    and (
      (project_id is null and public.has_role_on_account(account_id, 'owner'))
      or (project_id is not null and public.can_write_project(project_id))
    )
  )
  with check (
    not is_builtin
    and account_id is not null
    and (
      (project_id is null and public.has_role_on_account(account_id, 'owner'))
      or (project_id is not null and public.can_write_project(project_id))
    )
  );

comment on column public.external_sources.account_id is
  'KB-37: the team a source belongs to. Null for built-ins and for pre-fix sources awaiting attachment.';
comment on column public.external_sources.is_builtin is
  'KB-37: the seeded platform catalogue. Read by everyone, written only by migrations; the only rows the aggregator searches.';
comment on column public.external_sources.project_id is
  'KB-26: set for a project source (uploads, and sources added in a project''s hub). Its account_id is the project''s team (KB-37).';
