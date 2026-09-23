-- KB-41: get_project_members returned any project's members -- names, emails,
-- pictures -- to any signed-in caller, for any project, public or private.
-- It is SECURITY DEFINER, so row-level security does not apply inside it and
-- this check is the only guard.
--
-- Reads follow account membership: the caller must be the project account's
-- primary owner or hold a role on it (public.has_account_access), which is the
-- rule project_members_read already states. A project's visibility grants
-- nothing. A refused call and an unknown project both return no rows.
--
-- Signature and result are unchanged, so existing grants (authenticated only;
-- anon has none) and the generated types stay as they are.

create or replace function public.get_project_members(
  target_project_id uuid
) returns table (
  id uuid,
  project_id uuid,
  user_id uuid,
  role public.project_role,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  user_name varchar(255),
  user_email varchar(320),
  user_picture_url varchar(1000)
)
language plpgsql
security definer
set search_path = '' as $$
begin
  if not exists (
    select 1
    from public.projects p
    where p.id = target_project_id
      and public.has_account_access(p.account_id)
  ) then
    return;
  end if;

  return query
  select
    pm.id,
    pm.project_id,
    pm.user_id,
    pm.role,
    pm.created_at,
    pm.updated_at,
    a.name as user_name,
    a.email as user_email,
    a.picture_url as user_picture_url
  from public.project_members pm
  join public.accounts a on a.id = pm.user_id
  where pm.project_id = target_project_id
  order by pm.created_at asc;
end;
$$;
