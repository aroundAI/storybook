-- Fix infinite recursion in projects update RLS policy
-- The issue: projects_update policy queries project_members,
-- which has RLS policies that reference projects, causing circular dependency

-- Create a SECURITY DEFINER function to check project edit permission without RLS
create or replace function public.can_edit_project(
  target_project_id uuid
) returns boolean
language sql
security definer
set search_path = '' as $$
  select exists(
    select 1
    from public.project_members
    where project_id = target_project_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

grant execute on function public.can_edit_project(uuid) to authenticated;

-- Drop the old policy that causes recursion
drop policy if exists "projects_update" on public.projects;

-- Create new update policy using the SECURITY DEFINER function
create policy "projects_update" on public.projects for update
  to authenticated using (
    public.can_edit_project(id)
  )
  with check (
    public.can_edit_project(id)
  );
