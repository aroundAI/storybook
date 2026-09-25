-- FILM-CC-04 KB-99 (part 2). Team accounts only: a project, and every row of
-- an account-scoped workspace table, belongs to a team account.
--
-- Before this, `projects_create` explicitly admitted a personal account's
-- owner, and a signed-in user could create a project, a platform connection
-- and more on their own personal account: rows no page shows, since every
-- workspace page is team-scoped (KB-99 has the reproduction).
--
-- The rule lives in one trigger, which every writer passes through: the REST
-- API, server actions, and service-role workers alike. The server actions
-- also check first, so a person gets a readable sentence (KB-6).
--
-- Tables with an FK to `accounts` that legitimately hold personal-account rows
-- are left alone: notifications, audit_logs, billing (billing_customers,
-- subscriptions, orders), accounts_memberships and invitations (which
-- Makerkit already keeps to teams), and llm_usage_analytics: an LLM call that
-- reads no workspace (`noTenantLlmJobTarget`, the news and asset-description
-- actions) records its usage on the caller's personal account, and
-- `logLLMUsage` swallows a refused insert, so guarding it would silently
-- drop that usage. `team-accounts-only.test.sql` requires every
-- FK-to-accounts table to be guarded or named in that list.
--
-- This migration changes no data. The owner states that no production row
-- sits on a personal account (2026-09-25); if one does, the migration stops
-- here, names the tables, and changes nothing, rather than guard around rows
-- the owner has to decide about.

create or replace function kit.require_team_account ()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
begin
  if new.account_id is not null and exists (
    select 1
    from public.accounts a
    where a.id = new.account_id
      and a.is_personal_account
  ) then
    raise exception using
      errcode = '23514',
      message = 'Projects and workspace data belong to a team. Choose a team, or create one, first.',
      detail = format('%s.account_id names a personal account', tg_table_name);
  end if;

  return new;
end;
$$;

revoke all on function kit.require_team_account () from public, anon, authenticated;

-- One list: checked for existing rows first, then guarded.
do $$
declare
  guarded constant text[] := array[
    'projects',
    'account_oauth_apps',
    'analytics_experiments',
    'analytics_settings',
    'batch_generation_jobs',
    'channel_analytics_settings',
    'compilations',
    'content_tags',
    'external_api_keys',
    'generation_jobs',
    'manual_tasks',
    'platform_connections',
    'project_templates',
    'revenue_alerts',
    'revenue_records',
    'revenue_reports',
    'scheduled_reports',
    'shared_resources',
    'social_posts'
  ];
  tbl text;
  n bigint;
  found_rows text[] := '{}';
begin
  foreach tbl in array guarded loop
    execute format(
      'select count(*) from public.%I t join public.accounts a on a.id = t.account_id where a.is_personal_account',
      tbl
    ) into n;

    if n > 0 then
      found_rows := found_rows || format('%s: %s', tbl, n);
    end if;
  end loop;

  if cardinality(found_rows) > 0 then
    raise exception 'KB-99: rows sit on personal accounts; nothing was changed'
      using detail = array_to_string(found_rows, ', '),
            hint = 'Move each to a team or delete it (an owner decision), then apply this migration again.';
  end if;

  foreach tbl in array guarded loop
    execute format(
      'create trigger require_team_account before insert or update of account_id on public.%I for each row execute function kit.require_team_account()',
      tbl
    );
  end loop;
end;
$$;

-- The policy said a personal account's owner may create projects. It now
-- says what the trigger enforces.
drop policy if exists projects_create on public.projects;

create policy projects_create on public.projects
  for insert
  to authenticated
  with check (public.has_role_on_account (account_id));
