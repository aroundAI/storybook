-- ==================================
-- Projects Schema
-- ==================================
-- Multi-tenant project management system
-- Follows MakerKit account-scoped patterns
-- RLS-first security model

-- Project roles enum
create type public.project_role as enum (
  'owner',
  'admin',
  'member',
  'viewer'
);

-- Project actions for permissions
create type public.project_action as enum (
  'project.view',
  'project.edit',
  'project.delete',
  'project.members.view',
  'project.members.add',
  'project.members.remove',
  'project.settings.view',
  'project.settings.edit'
);

-- Projects table
create table if not exists public.projects (
  id uuid unique not null default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade not null,
  name varchar(255) not null,
  description text,
  slug text,
  status varchar(50) default 'active' not null check (status in ('active', 'archived', 'deleted')),
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  primary key (id),
  unique (account_id, slug)
);

-- Indexes for performance
create index if not exists ix_projects_account_id on public.projects (account_id);
create index if not exists ix_projects_status on public.projects (status) where status = 'active';
create index if not exists ix_projects_slug on public.projects (account_id, slug);

-- Timestamps and audit trail
create trigger projects_set_timestamps
before insert or update on public.projects
for each row execute function public.trigger_set_timestamps();

create trigger projects_set_user_tracking
before insert or update on public.projects
for each row execute function public.trigger_set_user_tracking();

-- Project members table
create table if not exists public.project_members (
  id uuid unique not null default extensions.uuid_generate_v4(),
  project_id uuid references public.projects(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  role public.project_role default 'member' not null,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_by uuid references auth.users,
  updated_by uuid references auth.users,
  primary key (id),
  unique (project_id, user_id)
);

-- Ensure one owner per project
create unique index if not exists ix_project_members_owner
on public.project_members (project_id)
where role = 'owner';

-- Indexes for membership queries
create index if not exists ix_project_members_project_id on public.project_members (project_id);
create index if not exists ix_project_members_user_id on public.project_members (user_id);

-- Timestamps and audit trail
create trigger project_members_set_timestamps
before insert or update on public.project_members
for each row execute function public.trigger_set_timestamps();

create trigger project_members_set_user_tracking
before insert or update on public.project_members
for each row execute function public.trigger_set_user_tracking();

-- ==================================
-- RLS Policies
-- ==================================

-- Enable RLS
alter table public.projects enable row level security;
alter table public.project_members enable row level security;

-- Revoke default permissions
revoke all on public.projects from authenticated, service_role;
revoke all on public.project_members from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.projects to authenticated;
grant select, insert, update, delete on table public.project_members to authenticated;

-- Projects policies
create policy "projects_read" on public.projects for select
  to authenticated using (
    -- User has account access
    public.has_role_on_account(account_id)
    or
    -- User is project member
    exists (
      select 1 from public.project_members
      where project_id = projects.id
      and user_id = auth.uid()
    )
  );

create policy "projects_create" on public.projects for insert
  to authenticated with check (
    -- Must have account permissions
    public.has_permission(auth.uid(), account_id, 'billing.manage'::app_permissions)
  );

create policy "projects_update" on public.projects for update
  to authenticated using (
    exists (
      select 1 from public.project_members
      where project_id = projects.id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.project_members
      where project_id = projects.id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

create policy "projects_delete" on public.projects for delete
  to authenticated using (
    exists (
      select 1 from public.project_members
      where project_id = projects.id
      and user_id = auth.uid()
      and role = 'owner'
    )
  );

-- Project members policies
create policy "project_members_read" on public.project_members for select
  to authenticated using (
    -- User is a member
    user_id = auth.uid()
    or
    -- User has account access
    exists (
      select 1 from public.projects
      where id = project_members.project_id
      and public.has_role_on_account(account_id)
    )
    or
    -- User is another project member
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
    )
  );

create policy "project_members_create" on public.project_members for insert
  to authenticated with check (
    -- Must be admin or owner
    exists (
      select 1 from public.project_members
      where project_id = project_members.project_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
    )
  );

create policy "project_members_update" on public.project_members for update
  to authenticated using (
    -- Must be admin or owner
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  )
  with check (
    -- Must be admin or owner
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

create policy "project_members_delete" on public.project_members for delete
  to authenticated using (
    -- Self-removal allowed
    user_id = auth.uid()
    or
    -- Admin/owner can remove others
    exists (
      select 1 from public.project_members pm
      where pm.project_id = project_members.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Helper Functions
-- ==================================

-- Check if user has role on project
create or replace function public.has_role_on_project(
  target_project_id uuid,
  target_role public.project_role default null
) returns boolean
language sql
security invoker
set search_path = '' as $$
  select exists(
    select 1
    from public.project_members
    where project_id = target_project_id
      and user_id = auth.uid()
      and (role = target_role or target_role is null)
  );
$$;

grant execute on function public.has_role_on_project(uuid, public.project_role) to authenticated;

-- Check if user can perform action on project
create or replace function public.can_perform_project_action(
  target_project_id uuid,
  action public.project_action
) returns boolean
language plpgsql
security invoker
set search_path = '' as $$
declare
  user_role public.project_role;
begin
  -- Get user's role on project
  select role into user_role
  from public.project_members
  where project_id = target_project_id
    and user_id = auth.uid();

  -- No membership = no access
  if user_role is null then
    return false;
  end if;

  -- Owner can do everything
  if user_role = 'owner' then
    return true;
  end if;

  -- Admin permissions
  if user_role = 'admin' then
    return action != 'project.delete'; -- Can't delete
  end if;

  -- Member permissions
  if user_role = 'member' then
    return action in (
      'project.view',
      'project.members.view'
    );
  end if;

  -- Viewer permissions
  if user_role = 'viewer' then
    return action in ('project.view');
  end if;

  return false;
end;
$$;

grant execute on function public.can_perform_project_action(uuid, public.project_action) to authenticated;

-- Get projects for account with user role
create or replace function public.get_account_projects(
  target_account_id uuid
) returns table (
  id uuid,
  account_id uuid,
  name varchar(255),
  description text,
  slug text,
  status varchar(50),
  metadata jsonb,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  user_role public.project_role
)
language sql
security invoker
set search_path = '' as $$
  select
    p.id,
    p.account_id,
    p.name,
    p.description,
    p.slug,
    p.status,
    p.metadata,
    p.created_at,
    p.updated_at,
    pm.role as user_role
  from public.projects p
  left join public.project_members pm
    on p.id = pm.project_id
    and pm.user_id = auth.uid()
  where p.account_id = target_account_id
    and p.status = 'active'
    and (
      public.has_role_on_account(p.account_id)
      or pm.user_id is not null
    )
  order by p.created_at desc;
$$;

grant execute on function public.get_account_projects(uuid) to authenticated;
