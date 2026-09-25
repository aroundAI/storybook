-- KB-49, KB-47 (publishing). What the service-role workers ask before they act.
--
-- 1. `can_user_write_project(user, project)`: KB-28's `can_write_project`
--    rule, for a user named by a queued job instead of the session's. The
--    LLM, voice and publish workers run on the service-role key, so
--    `auth.uid()` is nobody there; this is how they ask the same question.
--    `can_write_project` now calls it, so the rule is written once.
--    Executable by `service_role` only: granted to `authenticated`, it would
--    let any signed-in user ask whether someone else can write a project.
--
-- 2. `publishes.status` gains 'deleting'. The unpublish actions have always
--    set it before queueing the delete, and the check constraint has always
--    refused it — the error was ignored and the job sent regardless, for
--    callers who could not write the publish too. The actions now queue only
--    rows the update returned, and the worker deletes only a row in
--    'deleting', which only a caller who passed `publishes_update` can set.

create or replace function public.can_user_write_project (
  target_user_id uuid,
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  select exists (
    select 1
    from public.project_members pm
    where pm.project_id = target_project_id
      and pm.user_id = target_user_id
      and pm.role in ('owner', 'admin', 'member')
  );
$$;

revoke all on function public.can_user_write_project (uuid, uuid) from public, anon, authenticated;
grant execute on function public.can_user_write_project (uuid, uuid) to service_role;

create or replace function public.can_write_project (target_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = '' as $$
  select public.can_user_write_project(auth.uid(), target_project_id);
$$;

alter table public.publishes drop constraint if exists publishes_status_check;

alter table public.publishes add constraint publishes_status_check
  check (status in ('draft', 'scheduled', 'queued', 'publishing', 'published', 'failed', 'unlisted', 'deleted', 'deleting'));

comment on column public.publishes.status is 'Publish status: draft, scheduled, queued, publishing, published, failed, unlisted, deleted, deleting (an unpublish is queued)';
