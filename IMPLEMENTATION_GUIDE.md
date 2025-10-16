# Implementation Guide: Projects, Audit Logs, LLM Wrappers, Semantic Caching & Prompt Management

**Version:** 1.1
**Last Updated:** 2025-10-16
**Target Framework:** Next.js 15 + Supabase + Turborepo

This comprehensive guide provides production-ready implementation code for five major features:

1. **Projects Data Model** - Multi-tenant project management following MakerKit patterns
2. **Scoped Audit Logs** - Flexible audit trail system for any object type
3. **LLM Wrapper Abstraction** - Unified interface for OpenAI, Anthropic, Gemini, etc.
4. **Semantic Caching for LLMs** - Vector-based similarity caching for AI responses
5. **Prompt Templating & Library** - Enterprise-grade prompt management system

---

## Table of Contents

1. [Projects Data Model](#1-projects-data-model)
2. [Scoped Audit Logs](#2-scoped-audit-logs)
3. [LLM Wrapper Abstraction](#3-llm-wrapper-abstraction)
4. [Semantic Caching for LLMs](#4-semantic-caching-for-llms)
5. [Prompt Templating & Library](#5-prompt-templating--library)
6. [Migration Guide](#6-migration-guide)
7. [Testing Strategy](#7-testing-strategy)

---

## 1. Projects Data Model

### 1.1 Database Schema

Create `apps/web/supabase/schemas/18-projects.sql`:

```sql
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
    -- Cannot change owner role
    and (old.role != 'owner' or new.role = 'owner')
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
```

### 1.2 TypeScript Types

Create `packages/features/projects/src/lib/types.ts`:

```typescript
import type { Database } from '@kit/supabase/database';

export type Project = Database['public']['Tables']['projects']['Row'];
export type ProjectInsert = Database['public']['Tables']['projects']['Insert'];
export type ProjectUpdate = Database['public']['Tables']['projects']['Update'];

export type ProjectMember = Database['public']['Tables']['project_members']['Row'];
export type ProjectMemberInsert = Database['public']['Tables']['project_members']['Insert'];
export type ProjectMemberUpdate = Database['public']['Tables']['project_members']['Update'];

export type ProjectRole = Database['public']['Enums']['project_role'];
export type ProjectAction = Database['public']['Enums']['project_action'];

export interface ProjectWithRole extends Project {
  user_role: ProjectRole | null;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user: {
    id: string;
    email: string;
    display_name: string | null;
  };
}
```

### 1.3 Zod Schemas

Create `packages/features/projects/src/lib/schemas/project.schema.ts`:

```typescript
import { z } from 'zod';

export const CreateProjectSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  slug: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
});

export const UpdateProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  status: z.enum(['active', 'archived', 'deleted']).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const DeleteProjectSchema = z.object({
  projectId: z.string().uuid(),
});

export const AddProjectMemberSchema = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']).default('member'),
});

export const UpdateProjectMemberSchema = z.object({
  memberId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
});

export const RemoveProjectMemberSchema = z.object({
  memberId: z.string().uuid(),
});
```

### 1.4 Server Actions

Create `packages/features/projects/src/lib/server/project.mutations.ts`:

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { revalidatePath } from 'next/cache';

import {
  CreateProjectSchema,
  UpdateProjectSchema,
  DeleteProjectSchema,
  AddProjectMemberSchema,
  UpdateProjectMemberSchema,
  RemoveProjectMemberSchema,
} from '../schemas/project.schema';

/**
 * Create a new project
 */
export const createProjectAction = enhanceAction(
  async (data, user) => {
    const supabase = getSupabaseServerClient();

    // Generate slug if not provided
    const slug =
      data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        account_id: data.accountId,
        name: data.name,
        description: data.description,
        slug,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create project: ${error.message}`);
    }

    // Add creator as owner
    const { error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_id: project.id,
        user_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      // Rollback project creation
      await supabase.from('projects').delete().eq('id', project.id);
      throw new Error(`Failed to add project owner: ${memberError.message}`);
    }

    revalidatePath(`/home/[account]`, 'layout');

    return { data: project };
  },
  {
    schema: CreateProjectSchema,
    auth: true,
  },
);

/**
 * Update project
 */
export const updateProjectAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { projectId, ...updates } = data;

    const { data: project, error } = await supabase
      .from('projects')
      .update(updates)
      .eq('id', projectId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update project: ${error.message}`);
    }

    revalidatePath(`/home/[account]/projects/${projectId}`, 'page');

    return { data: project };
  },
  {
    schema: UpdateProjectSchema,
    auth: true,
  },
);

/**
 * Delete project (soft delete by setting status)
 */
export const deleteProjectAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase
      .from('projects')
      .update({ status: 'deleted' })
      .eq('id', data.projectId);

    if (error) {
      throw new Error(`Failed to delete project: ${error.message}`);
    }

    revalidatePath(`/home/[account]`, 'layout');

    return { data: { success: true } };
  },
  {
    schema: DeleteProjectSchema,
    auth: true,
  },
);

/**
 * Add project member
 */
export const addProjectMemberAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { data: member, error } = await supabase
      .from('project_members')
      .insert({
        project_id: data.projectId,
        user_id: data.userId,
        role: data.role,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add project member: ${error.message}`);
    }

    revalidatePath(`/home/[account]/projects/${data.projectId}/members`, 'page');

    return { data: member };
  },
  {
    schema: AddProjectMemberSchema,
    auth: true,
  },
);

/**
 * Update project member role
 */
export const updateProjectMemberAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { data: member, error } = await supabase
      .from('project_members')
      .update({ role: data.role })
      .eq('id', data.memberId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update project member: ${error.message}`);
    }

    revalidatePath(`/home/[account]/projects`, 'layout');

    return { data: member };
  },
  {
    schema: UpdateProjectMemberSchema,
    auth: true,
  },
);

/**
 * Remove project member
 */
export const removeProjectMemberAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('id', data.memberId);

    if (error) {
      throw new Error(`Failed to remove project member: ${error.message}`);
    }

    revalidatePath(`/home/[account]/projects`, 'layout');

    return { data: { success: true } };
  },
  {
    schema: RemoveProjectMemberSchema,
    auth: true,
  },
);
```

### 1.5 Query Functions

Create `packages/features/projects/src/lib/server/project.queries.ts`:

```typescript
'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { ProjectWithRole, ProjectMemberWithUser } from '../types';

/**
 * Get all projects for an account
 */
export async function getAccountProjects(accountId: string): Promise<ProjectWithRole[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_account_projects', {
    target_account_id: accountId,
  });

  if (error) {
    throw new Error(`Failed to load projects: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get single project by ID
 */
export async function getProject(projectId: string): Promise<ProjectWithRole | null> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('projects')
    .select(`
      *,
      project_members!inner(role)
    `)
    .eq('id', projectId)
    .eq('project_members.user_id', (await supabase.auth.getUser()).data.user?.id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to load project: ${error.message}`);
  }

  return {
    ...data,
    user_role: data.project_members?.[0]?.role ?? null,
  } as ProjectWithRole;
}

/**
 * Get project members
 */
export async function getProjectMembers(projectId: string): Promise<ProjectMemberWithUser[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('project_members')
    .select(`
      *,
      user:user_id (
        id,
        email,
        display_name
      )
    `)
    .eq('project_id', projectId)
    .order('role', { ascending: true });

  if (error) {
    throw new Error(`Failed to load project members: ${error.message}`);
  }

  return data as unknown as ProjectMemberWithUser[];
}

/**
 * Check if user can perform action on project
 */
export async function canPerformProjectAction(
  projectId: string,
  action: string,
): Promise<boolean> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('can_perform_project_action', {
    target_project_id: projectId,
    action,
  });

  if (error) return false;
  return data === true;
}
```

### 1.6 Client Components

Create `packages/features/projects/src/components/create-project-form.tsx`:

```typescript
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@kit/ui/sonner';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { useTransition } from 'react';

import { CreateProjectSchema } from '../lib/schemas/project.schema';
import { createProjectAction } from '../lib/server/project.mutations';

interface CreateProjectFormProps {
  accountId: string;
  onSuccess?: () => void;
}

export function CreateProjectForm({ accountId, onSuccess }: CreateProjectFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      accountId,
      name: '',
      description: '',
      slug: '',
    },
  });

  const onSubmit = (data: unknown) => {
    startTransition(async () => {
      try {
        const result = await createProjectAction(data);

        if (result.success) {
          toast.success('Project created successfully');
          form.reset();
          onSuccess?.();
        } else {
          toast.error(result.error ?? 'Failed to create project');
        }
      } catch (error) {
        toast.error('An unexpected error occurred');
        console.error('Create project error:', error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Name</FormLabel>
              <FormControl>
                <Input placeholder="My Awesome Project" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project Slug</FormLabel>
              <FormControl>
                <Input placeholder="my-awesome-project" {...field} />
              </FormControl>
              <FormDescription>
                Lowercase alphanumeric with hyphens. Auto-generated if left blank.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="What is this project about?"
                  {...field}
                  rows={4}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type="submit" disabled={isPending}>
          {isPending ? 'Creating...' : 'Create Project'}
        </Button>
      </form>
    </Form>
  );
}
```

### 1.7 Page Example

Create `apps/web/app/home/[account]/projects/page.tsx`:

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { CreateProjectForm } from '@kit/features/projects';
import { getAccountProjects } from '@kit/features/projects/server';

interface ProjectsPageProps {
  params: Promise<{ account: string }>;
}

export default async function ProjectsPage({ params }: ProjectsPageProps) {
  const { account: accountSlug } = await params;

  const supabase = getSupabaseServerClient();

  // Get account by slug
  const { data: account } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('slug', accountSlug)
    .single();

  if (!account) {
    return <div>Account not found</div>;
  }

  // Get projects
  const projects = await getAccountProjects(account.id);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Projects</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Projects list */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Your Projects</h2>
          {projects.length === 0 ? (
            <p className="text-muted-foreground">No projects yet</p>
          ) : (
            <ul className="space-y-2">
              {projects.map((project) => (
                <li key={project.id} className="p-4 border rounded">
                  <h3 className="font-medium">{project.name}</h3>
                  {project.description && (
                    <p className="text-sm text-muted-foreground">{project.description}</p>
                  )}
                  <span className="text-xs text-muted-foreground">
                    Role: {project.user_role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Create form */}
        <div>
          <h2 className="text-xl font-semibold mb-4">Create New Project</h2>
          <CreateProjectForm accountId={account.id} />
        </div>
      </div>
    </div>
  );
}
```

---

## 2. Scoped Audit Logs

### 2.1 Database Schema

Create `apps/web/supabase/schemas/19-audit-logs.sql`:

```sql
-- ==================================
-- Audit Logs Schema
-- ==================================
-- Flexible audit trail system for tracking changes
-- Supports any object type and multi-object scoping
-- Polymorphic associations with JSONB metadata

-- Audit log action types
create type public.audit_action as enum (
  'created',
  'updated',
  'deleted',
  'accessed',
  'exported',
  'shared',
  'archived',
  'restored',
  'permission_changed',
  'member_added',
  'member_removed',
  'role_changed'
);

-- Audit logs table
create table if not exists public.audit_logs (
  id uuid unique not null default extensions.uuid_generate_v4(),

  -- Account scope (all logs belong to an account)
  account_id uuid references public.accounts(id) on delete cascade not null,

  -- Actor (who performed the action)
  user_id uuid references auth.users(id) on delete set null,
  user_email text, -- Cached for historical records
  user_name text,  -- Cached for historical records

  -- Action details
  action public.audit_action not null,
  description text,

  -- Primary object being acted upon
  object_type text not null, -- 'account', 'project', 'note', 'user', etc.
  object_id uuid,
  object_name text, -- Cached for display

  -- Secondary objects (for multi-object actions)
  -- Example: Adding user to project = {object_type: 'project', related: [{type: 'user', id: ...}]}
  related_objects jsonb default '[]'::jsonb,

  -- Additional context
  metadata jsonb default '{}'::jsonb,

  -- Request context
  ip_address inet,
  user_agent text,

  -- Timestamp
  created_at timestamp with time zone default now() not null,

  primary key (id)
);

-- Indexes for efficient queries
create index if not exists ix_audit_logs_account_id on public.audit_logs (account_id, created_at desc);
create index if not exists ix_audit_logs_user_id on public.audit_logs (user_id, created_at desc);
create index if not exists ix_audit_logs_object on public.audit_logs (object_type, object_id);
create index if not exists ix_audit_logs_action on public.audit_logs (action, created_at desc);
create index if not exists ix_audit_logs_created_at on public.audit_logs (created_at desc);

-- GIN index for JSONB queries
create index if not exists ix_audit_logs_metadata on public.audit_logs using gin (metadata);
create index if not exists ix_audit_logs_related_objects on public.audit_logs using gin (related_objects);

-- ==================================
-- RLS Policies
-- ==================================

alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from authenticated, service_role;
grant select, insert on table public.audit_logs to authenticated;

-- Read policy: Users can read logs for accounts they have access to
create policy "audit_logs_read" on public.audit_logs for select
  to authenticated using (
    public.has_role_on_account(account_id)
  );

-- Insert policy: Authenticated users can create logs
create policy "audit_logs_create" on public.audit_logs for insert
  to authenticated with check (
    user_id = auth.uid()
    and public.has_role_on_account(account_id)
  );

-- No update or delete policies (audit logs are immutable)

-- ==================================
-- Helper Functions
-- ==================================

-- Create audit log entry
create or replace function public.create_audit_log(
  p_account_id uuid,
  p_action public.audit_action,
  p_object_type text,
  p_object_id uuid default null,
  p_object_name text default null,
  p_description text default null,
  p_related_objects jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security invoker
set search_path = '' as $$
declare
  v_log_id uuid;
  v_user_id uuid;
  v_user_email text;
  v_user_name text;
begin
  -- Get current user info
  select auth.uid() into v_user_id;

  if v_user_id is not null then
    select email, raw_user_meta_data->>'display_name'
    into v_user_email, v_user_name
    from auth.users
    where id = v_user_id;
  end if;

  -- Insert audit log
  insert into public.audit_logs (
    account_id,
    user_id,
    user_email,
    user_name,
    action,
    description,
    object_type,
    object_id,
    object_name,
    related_objects,
    metadata
  ) values (
    p_account_id,
    v_user_id,
    v_user_email,
    v_user_name,
    p_action,
    p_description,
    p_object_type,
    p_object_id,
    p_object_name,
    p_related_objects,
    p_metadata
  )
  returning id into v_log_id;

  return v_log_id;
end;
$$;

grant execute on function public.create_audit_log(uuid, public.audit_action, text, uuid, text, text, jsonb, jsonb) to authenticated;

-- Get audit logs for account
create or replace function public.get_account_audit_logs(
  p_account_id uuid,
  p_limit int default 100,
  p_offset int default 0,
  p_object_type text default null,
  p_object_id uuid default null,
  p_user_id uuid default null,
  p_action public.audit_action default null
) returns setof public.audit_logs
language sql
security invoker
set search_path = '' as $$
  select *
  from public.audit_logs
  where account_id = p_account_id
    and (p_object_type is null or object_type = p_object_type)
    and (p_object_id is null or object_id = p_object_id)
    and (p_user_id is null or user_id = p_user_id)
    and (p_action is null or action = p_action)
  order by created_at desc
  limit p_limit
  offset p_offset;
$$;

grant execute on function public.get_account_audit_logs(uuid, int, int, text, uuid, uuid, public.audit_action) to authenticated;

-- Get audit logs for a specific object and its related objects
create or replace function public.get_object_audit_trail(
  p_object_type text,
  p_object_id uuid,
  p_limit int default 100
) returns setof public.audit_logs
language sql
security invoker
set search_path = '' as $$
  select *
  from public.audit_logs
  where (
    -- Primary object matches
    (object_type = p_object_type and object_id = p_object_id)
    or
    -- Object appears in related_objects
    related_objects @> jsonb_build_array(
      jsonb_build_object('type', p_object_type, 'id', p_object_id)
    )
  )
  order by created_at desc
  limit p_limit;
$$;

grant execute on function public.get_object_audit_trail(text, uuid, int) to authenticated;

-- ==================================
-- Automatic Audit Logging Triggers
-- ==================================

-- Generic trigger function for audit logging
create or replace function public.trigger_audit_log()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare
  v_action public.audit_action;
  v_object_type text;
  v_account_id uuid;
  v_object_name text;
begin
  -- Determine action
  if TG_OP = 'INSERT' then
    v_action := 'created';
  elsif TG_OP = 'UPDATE' then
    v_action := 'updated';
  elsif TG_OP = 'DELETE' then
    v_action := 'deleted';
  end if;

  -- Get table name as object type
  v_object_type := TG_TABLE_NAME;

  -- Get account_id and object_name (assume standard column names)
  if TG_OP = 'DELETE' then
    v_account_id := OLD.account_id;
    v_object_name := coalesce(OLD.name, OLD.title, OLD.id::text);
  else
    v_account_id := NEW.account_id;
    v_object_name := coalesce(NEW.name, NEW.title, NEW.id::text);
  end if;

  -- Create audit log
  perform public.create_audit_log(
    p_account_id := v_account_id,
    p_action := v_action,
    p_object_type := v_object_type,
    p_object_id := coalesce(NEW.id, OLD.id),
    p_object_name := v_object_name
  );

  return null;
end;
$$;

-- Example: Add audit logging to projects table
create trigger projects_audit_log
after insert or update or delete on public.projects
for each row execute function public.trigger_audit_log();
```

### 2.2 TypeScript Types

Create `packages/features/audit-logs/src/lib/types.ts`:

```typescript
import type { Database } from '@kit/supabase/database';

export type AuditLog = Database['public']['Tables']['audit_logs']['Row'];
export type AuditLogInsert = Database['public']['Tables']['audit_logs']['Insert'];
export type AuditAction = Database['public']['Enums']['audit_action'];

export interface RelatedObject {
  type: string;
  id: string;
  name?: string;
}

export interface AuditLogMetadata {
  [key: string]: unknown;
}

export interface CreateAuditLogParams {
  accountId: string;
  action: AuditAction;
  objectType: string;
  objectId?: string;
  objectName?: string;
  description?: string;
  relatedObjects?: RelatedObject[];
  metadata?: AuditLogMetadata;
}
```

### 2.3 Server Functions

Create `packages/features/audit-logs/src/lib/server/audit-log.mutations.ts`:

```typescript
'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { CreateAuditLogParams } from '../types';

/**
 * Create an audit log entry
 */
export async function createAuditLog(params: CreateAuditLogParams): Promise<string> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('create_audit_log', {
    p_account_id: params.accountId,
    p_action: params.action,
    p_object_type: params.objectType,
    p_object_id: params.objectId ?? null,
    p_object_name: params.objectName ?? null,
    p_description: params.description ?? null,
    p_related_objects: params.relatedObjects ?? [],
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.error('[AuditLog] Failed to create audit log:', error);
    throw new Error(`Failed to create audit log: ${error.message}`);
  }

  return data;
}

/**
 * Helper to create audit log for project actions
 */
export async function logProjectAction(
  accountId: string,
  projectId: string,
  projectName: string,
  action: 'created' | 'updated' | 'deleted' | 'archived',
  metadata?: Record<string, unknown>,
): Promise<void> {
  await createAuditLog({
    accountId,
    action,
    objectType: 'project',
    objectId: projectId,
    objectName: projectName,
    metadata,
  });
}

/**
 * Helper to create audit log for member actions
 */
export async function logMemberAction(
  accountId: string,
  projectId: string,
  projectName: string,
  userId: string,
  userName: string,
  action: 'member_added' | 'member_removed' | 'role_changed',
  metadata?: Record<string, unknown>,
): Promise<void> {
  await createAuditLog({
    accountId,
    action,
    objectType: 'project',
    objectId: projectId,
    objectName: projectName,
    relatedObjects: [
      {
        type: 'user',
        id: userId,
        name: userName,
      },
    ],
    metadata,
  });
}
```

Create `packages/features/audit-logs/src/lib/server/audit-log.queries.ts`:

```typescript
'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { AuditLog, AuditAction } from '../types';

export interface GetAuditLogsParams {
  accountId: string;
  limit?: number;
  offset?: number;
  objectType?: string;
  objectId?: string;
  userId?: string;
  action?: AuditAction;
}

/**
 * Get audit logs for an account with optional filters
 */
export async function getAuditLogs(params: GetAuditLogsParams): Promise<AuditLog[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_account_audit_logs', {
    p_account_id: params.accountId,
    p_limit: params.limit ?? 100,
    p_offset: params.offset ?? 0,
    p_object_type: params.objectType ?? null,
    p_object_id: params.objectId ?? null,
    p_user_id: params.userId ?? null,
    p_action: params.action ?? null,
  });

  if (error) {
    throw new Error(`Failed to load audit logs: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get complete audit trail for a specific object
 */
export async function getObjectAuditTrail(
  objectType: string,
  objectId: string,
  limit = 100,
): Promise<AuditLog[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc('get_object_audit_trail', {
    p_object_type: objectType,
    p_object_id: objectId,
    p_limit: limit,
  });

  if (error) {
    throw new Error(`Failed to load object audit trail: ${error.message}`);
  }

  return data ?? [];
}
```

### 2.4 Client Component

Create `packages/features/audit-logs/src/components/audit-log-list.tsx`:

```typescript
'use client';

import { format } from 'date-fns';
import type { AuditLog } from '../lib/types';

interface AuditLogListProps {
  logs: AuditLog[];
}

const actionLabels: Record<string, string> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  accessed: 'Accessed',
  exported: 'Exported',
  shared: 'Shared',
  archived: 'Archived',
  restored: 'Restored',
  permission_changed: 'Permission Changed',
  member_added: 'Member Added',
  member_removed: 'Member Removed',
  role_changed: 'Role Changed',
};

export function AuditLogList({ logs }: AuditLogListProps) {
  if (logs.length === 0) {
    return <p className="text-muted-foreground">No audit logs found</p>;
  }

  return (
    <div className="space-y-4">
      {logs.map((log) => (
        <div key={log.id} className="flex gap-4 p-4 border rounded">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{actionLabels[log.action] ?? log.action}</span>
              <span className="text-muted-foreground">•</span>
              <span className="text-sm text-muted-foreground">
                {log.object_type}: {log.object_name ?? log.object_id}
              </span>
            </div>

            {log.description && (
              <p className="text-sm text-muted-foreground mt-1">{log.description}</p>
            )}

            <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
              <span>{log.user_name ?? log.user_email ?? 'Unknown user'}</span>
              <span>•</span>
              <span>{format(new Date(log.created_at), 'PPpp')}</span>
            </div>

            {log.related_objects && Array.isArray(log.related_objects) && log.related_objects.length > 0 && (
              <div className="mt-2 text-sm">
                <span className="text-muted-foreground">Related: </span>
                {(log.related_objects as Array<{ type: string; name?: string }>).map((obj, i) => (
                  <span key={i}>
                    {obj.name ?? obj.type}
                    {i < log.related_objects.length - 1 && ', '}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
```

### 2.5 Usage Example

Update `packages/features/projects/src/lib/server/project.mutations.ts` to include audit logging:

```typescript
import { logProjectAction, logMemberAction } from '@kit/features/audit-logs/server';

export const createProjectAction = enhanceAction(
  async (data, user) => {
    const supabase = getSupabaseServerClient();

    const slug = data.slug ?? data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

    const { data: project, error } = await supabase
      .from('projects')
      .insert({
        account_id: data.accountId,
        name: data.name,
        description: data.description,
        slug,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create project: ${error.message}`);
    }

    const { error: memberError } = await supabase
      .from('project_members')
      .insert({
        project_id: project.id,
        user_id: user.id,
        role: 'owner',
      });

    if (memberError) {
      await supabase.from('projects').delete().eq('id', project.id);
      throw new Error(`Failed to add project owner: ${memberError.message}`);
    }

    // Audit log
    await logProjectAction(
      data.accountId,
      project.id,
      project.name,
      'created',
      { description: data.description, slug },
    );

    revalidatePath(`/home/[account]`, 'layout');

    return { data: project };
  },
  {
    schema: CreateProjectSchema,
    auth: true,
  },
);
```

---

## 3. LLM Wrapper Abstraction

### 3.1 Core Abstraction Types

Create `packages/llm/src/types.ts`:

```typescript
/**
 * LLM provider types
 */
export type LLMProvider = 'openai' | 'anthropic' | 'gemini' | 'mistral' | 'groq';

/**
 * Message role
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'function';

/**
 * Chat message
 */
export interface ChatMessage {
  role: MessageRole;
  content: string;
  name?: string;
}

/**
 * LLM configuration
 */
export interface LLMConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

/**
 * Chat completion request
 */
export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
  functions?: FunctionDefinition[];
}

/**
 * Function calling definition
 */
export interface FunctionDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * Chat completion response
 */
export interface ChatCompletionResponse {
  id: string;
  provider: LLMProvider;
  model: string;
  message: ChatMessage;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost?: {
    prompt: number;
    completion: number;
    total: number;
  };
  finishReason: 'stop' | 'length' | 'function_call' | 'content_filter';
}

/**
 * Streaming chunk
 */
export interface StreamChunk {
  delta: string;
  done: boolean;
}

/**
 * LLM client interface
 */
export interface LLMClient {
  /**
   * Get provider name
   */
  getProvider(): LLMProvider;

  /**
   * Get model name
   */
  getModel(): string;

  /**
   * Create chat completion
   */
  createChatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Create streaming chat completion
   */
  createStreamingChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown>;

  /**
   * Calculate cost for tokens
   */
  calculateCost(promptTokens: number, completionTokens: number): {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * LLM error
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public provider: LLMProvider,
    public code?: string,
    public statusCode?: number,
  ) {
    super(message);
    this.name = 'LLMError';
  }
}
```

### 3.2 OpenAI Provider

Create `packages/llm/src/providers/openai.ts`:

```typescript
import OpenAI from 'openai';
import type {
  LLMClient,
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  LLMConfig,
} from '../types';
import { LLMError } from '../types';

// Pricing per 1M tokens (as of 2024)
const PRICING: Record<string, { prompt: number; completion: number }> = {
  'gpt-4-turbo': { prompt: 10, completion: 30 },
  'gpt-4': { prompt: 30, completion: 60 },
  'gpt-3.5-turbo': { prompt: 0.5, completion: 1.5 },
  'gpt-4o': { prompt: 5, completion: 15 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
};

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private model: string;
  private provider: LLMProvider = 'openai';

  constructor(config: LLMConfig) {
    if (config.provider !== 'openai') {
      throw new Error('Invalid provider for OpenAI client');
    }

    this.client = new OpenAI({
      apiKey: config.apiKey,
    });

    this.model = config.model;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getModel(): string {
    return this.model;
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map((msg) => ({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: false,
      });

      const choice = response.choices[0];
      if (!choice) {
        throw new LLMError('No response from OpenAI', this.provider);
      }

      const usage = response.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };

      return {
        id: response.id,
        provider: this.provider,
        model: this.model,
        message: {
          role: 'assistant',
          content: choice.message.content ?? '',
        },
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
        cost: this.calculateCost(usage.prompt_tokens, usage.completion_tokens),
        finishReason: (choice.finish_reason as ChatCompletionResponse['finishReason']) ?? 'stop',
      };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new LLMError(error.message, this.provider, error.code, error.status);
      }
      throw error;
    }
  }

  async *createStreamingChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: request.messages.map((msg) => ({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        })),
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content ?? '';
        const done = chunk.choices[0]?.finish_reason !== null;

        yield { delta, done };
      }
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        throw new LLMError(error.message, this.provider, error.code, error.status);
      }
      throw error;
    }
  }

  calculateCost(
    promptTokens: number,
    completionTokens: number,
  ): { prompt: number; completion: number; total: number } {
    const pricing = PRICING[this.model] ?? PRICING['gpt-4o-mini'];

    const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
    const completionCost = (completionTokens / 1_000_000) * pricing.completion;

    return {
      prompt: promptCost,
      completion: completionCost,
      total: promptCost + completionCost,
    };
  }
}
```

### 3.3 Anthropic Provider

Create `packages/llm/src/providers/anthropic.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk';
import type {
  LLMClient,
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  LLMConfig,
  ChatMessage,
} from '../types';
import { LLMError } from '../types';

// Pricing per 1M tokens
const PRICING: Record<string, { prompt: number; completion: number }> = {
  'claude-3-5-sonnet-20241022': { prompt: 3, completion: 15 },
  'claude-3-5-haiku-20241022': { prompt: 1, completion: 5 },
  'claude-3-opus-20240229': { prompt: 15, completion: 75 },
};

export class AnthropicClient implements LLMClient {
  private client: Anthropic;
  private model: string;
  private provider: LLMProvider = 'anthropic';

  constructor(config: LLMConfig) {
    if (config.provider !== 'anthropic') {
      throw new Error('Invalid provider for Anthropic client');
    }

    this.client = new Anthropic({
      apiKey: config.apiKey,
    });

    this.model = config.model;
  }

  getProvider(): LLMProvider {
    return this.provider;
  }

  getModel(): string {
    return this.model;
  }

  private convertMessages(messages: ChatMessage[]): {
    system?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  } {
    const systemMessage = messages.find((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    return {
      system: systemMessage?.content,
      messages: chatMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    };
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    try {
      const { system, messages } = this.convertMessages(request.messages);

      const response = await this.client.messages.create({
        model: this.model,
        system,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        top_p: request.topP,
        stream: false,
      });

      const textContent = response.content.find((c) => c.type === 'text');

      return {
        id: response.id,
        provider: this.provider,
        model: this.model,
        message: {
          role: 'assistant',
          content: textContent?.type === 'text' ? textContent.text : '',
        },
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        cost: this.calculateCost(
          response.usage.input_tokens,
          response.usage.output_tokens,
        ),
        finishReason: response.stop_reason === 'end_turn' ? 'stop' : 'length',
      };
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(error.message, this.provider, error.type, error.status);
      }
      throw error;
    }
  }

  async *createStreamingChatCompletion(
    request: ChatCompletionRequest,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    try {
      const { system, messages } = this.convertMessages(request.messages);

      const stream = await this.client.messages.create({
        model: this.model,
        system,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
        top_p: request.topP,
        stream: true,
      });

      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          yield { delta: chunk.delta.text, done: false };
        }

        if (chunk.type === 'message_stop') {
          yield { delta: '', done: true };
        }
      }
    } catch (error) {
      if (error instanceof Anthropic.APIError) {
        throw new LLMError(error.message, this.provider, error.type, error.status);
      }
      throw error;
    }
  }

  calculateCost(
    promptTokens: number,
    completionTokens: number,
  ): { prompt: number; completion: number; total: number } {
    const pricing = PRICING[this.model] ?? PRICING['claude-3-5-haiku-20241022'];

    const promptCost = (promptTokens / 1_000_000) * pricing.prompt;
    const completionCost = (completionTokens / 1_000_000) * pricing.completion;

    return {
      prompt: promptCost,
      completion: completionCost,
      total: promptCost + completionCost,
    };
  }
}
```

### 3.4 Factory Function

Create `packages/llm/src/factory.ts`:

```typescript
import type { LLMClient, LLMConfig } from './types';
import { OpenAIClient } from './providers/openai';
import { AnthropicClient } from './providers/anthropic';

/**
 * Create LLM client from configuration
 */
export function createLLMClient(config: LLMConfig): LLMClient {
  switch (config.provider) {
    case 'openai':
      return new OpenAIClient(config);
    case 'anthropic':
      return new AnthropicClient(config);
    // Add more providers here
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}

/**
 * Create LLM client from environment variables
 */
export function createLLMClientFromEnv(): LLMClient {
  const provider = (process.env.LLM_PROVIDER ?? 'openai') as LLMConfig['provider'];
  const model = process.env.LLM_MODEL ?? 'gpt-4o-mini';
  const apiKey = process.env.LLM_API_KEY ?? '';

  if (!apiKey) {
    throw new Error('LLM_API_KEY environment variable is required');
  }

  return createLLMClient({
    provider,
    model,
    apiKey,
  });
}
```

### 3.5 Usage Example

Create `packages/llm/src/examples/chat-completion.ts`:

```typescript
import { createLLMClient } from '../factory';

async function example() {
  // Create client
  const llm = createLLMClient({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  });

  // Regular completion
  const response = await llm.createChatCompletion({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'What is the capital of France?' },
    ],
    temperature: 0.7,
    maxTokens: 500,
  });

  console.log('Response:', response.message.content);
  console.log('Cost:', response.cost);
  console.log('Tokens:', response.usage);

  // Streaming completion
  console.log('\nStreaming response:');
  for await (const chunk of llm.createStreamingChatCompletion({
    messages: [
      { role: 'user', content: 'Write a short poem about TypeScript' },
    ],
  })) {
    process.stdout.write(chunk.delta);
    if (chunk.done) {
      console.log('\n[Stream complete]');
    }
  }
}

example();
```

---

## 4. Semantic Caching for LLMs

### 4.1 Vector Embeddings

Create `packages/llm/src/cache/embeddings.ts`:

```typescript
import OpenAI from 'openai';

/**
 * Generate embedding for text using OpenAI
 */
export async function generateEmbedding(
  text: string,
  apiKey: string,
): Promise<number[]> {
  const openai = new OpenAI({ apiKey });

  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });

  return response.data[0]?.embedding ?? [];
}

/**
 * Calculate cosine similarity between two vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error('Vectors must have same length');
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i]! * vecB[i]!;
    normA += vecA[i]! * vecA[i]!;
    normB += vecB[i]! * vecB[i]!;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

### 4.2 Semantic Cache Implementation

Create `packages/llm/src/cache/semantic-cache.ts`:

```typescript
import type { CacheClient } from '@kit/cache';
import { generateEmbedding, cosineSimilarity } from './embeddings';
import type { ChatMessage, ChatCompletionResponse } from '../types';

export interface SemanticCacheConfig {
  cache: CacheClient;
  embeddingApiKey: string;
  similarityThreshold?: number; // Default: 0.95 (95% similarity required)
  ttlSeconds?: number; // Default: 3600 (1 hour)
}

export interface CachedEntry {
  messages: ChatMessage[];
  embedding: number[];
  response: ChatCompletionResponse;
  createdAt: number;
}

/**
 * Semantic cache for LLM responses
 * Uses vector embeddings to find similar queries
 */
export class SemanticCache {
  private cache: CacheClient;
  private embeddingApiKey: string;
  private similarityThreshold: number;
  private ttlSeconds: number;

  constructor(config: SemanticCacheConfig) {
    this.cache = config.cache;
    this.embeddingApiKey = config.embeddingApiKey;
    this.similarityThreshold = config.similarityThreshold ?? 0.95;
    this.ttlSeconds = config.ttlSeconds ?? 3600;
  }

  /**
   * Create cache key from messages
   */
  private createMessagesHash(messages: ChatMessage[]): string {
    const text = messages.map((m) => `${m.role}:${m.content}`).join('|');
    // Simple hash - in production use crypto.createHash
    return `semantic:${Buffer.from(text).toString('base64').slice(0, 64)}`;
  }

  /**
   * Get list of all cached entries for similarity search
   */
  private async getAllCachedKeys(): Promise<string[]> {
    // Note: This requires a custom cache method or storing keys in a set
    // For now, we'll use a simple key pattern
    const indexKey = 'semantic:index';
    const keys = await this.cache.get<string[]>(indexKey);
    return keys ?? [];
  }

  /**
   * Add key to index
   */
  private async addToIndex(key: string): Promise<void> {
    const indexKey = 'semantic:index';
    const keys = (await this.cache.get<string[]>(indexKey)) ?? [];

    if (!keys.includes(key)) {
      keys.push(key);
      await this.cache.set(indexKey, keys, this.ttlSeconds);
    }
  }

  /**
   * Find cached response by semantic similarity
   */
  async get(messages: ChatMessage[]): Promise<ChatCompletionResponse | null> {
    try {
      // Generate embedding for query
      const queryText = messages.map((m) => m.content).join(' ');
      const queryEmbedding = await generateEmbedding(queryText, this.embeddingApiKey);

      // Get all cached entries
      const cachedKeys = await this.getAllCachedKeys();

      let bestMatch: CachedEntry | null = null;
      let bestSimilarity = 0;

      // Find most similar cached entry
      for (const key of cachedKeys) {
        const entry = await this.cache.get<CachedEntry>(key);
        if (!entry) continue;

        const similarity = cosineSimilarity(queryEmbedding, entry.embedding);

        if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
          bestSimilarity = similarity;
          bestMatch = entry;
        }
      }

      if (bestMatch) {
        console.log(`[SemanticCache] Cache hit with similarity: ${bestSimilarity.toFixed(3)}`);
        return bestMatch.response;
      }

      console.log(`[SemanticCache] Cache miss - best similarity: ${bestSimilarity.toFixed(3)}`);
      return null;
    } catch (error) {
      console.error('[SemanticCache] Get error:', error);
      return null;
    }
  }

  /**
   * Store response in cache with embedding
   */
  async set(
    messages: ChatMessage[],
    response: ChatCompletionResponse,
  ): Promise<void> {
    try {
      const key = this.createMessagesHash(messages);

      // Generate embedding
      const queryText = messages.map((m) => m.content).join(' ');
      const embedding = await generateEmbedding(queryText, this.embeddingApiKey);

      const entry: CachedEntry = {
        messages,
        embedding,
        response,
        createdAt: Date.now(),
      };

      await this.cache.set(key, entry, this.ttlSeconds);
      await this.addToIndex(key);

      console.log('[SemanticCache] Cached response');
    } catch (error) {
      console.error('[SemanticCache] Set error:', error);
    }
  }

  /**
   * Clear all semantic cache entries
   */
  async clear(): Promise<void> {
    const keys = await this.getAllCachedKeys();
    await this.cache.mdel(keys);
    await this.cache.del('semantic:index');
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    entries: number;
    metrics: ReturnType<CacheClient['getMetrics']>;
  }> {
    const keys = await this.getAllCachedKeys();
    return {
      entries: keys.length,
      metrics: this.cache.getMetrics(),
    };
  }
}
```

### 4.3 LLM Client with Semantic Caching

Create `packages/llm/src/cache/cached-llm-client.ts`:

```typescript
import type { LLMClient, ChatCompletionRequest, ChatCompletionResponse } from '../types';
import type { SemanticCache } from './semantic-cache';

/**
 * LLM client wrapper with semantic caching
 */
export class CachedLLMClient implements LLMClient {
  constructor(
    private client: LLMClient,
    private cache: SemanticCache,
  ) {}

  getProvider() {
    return this.client.getProvider();
  }

  getModel() {
    return this.client.getModel();
  }

  async createChatCompletion(
    request: ChatCompletionRequest,
  ): Promise<ChatCompletionResponse> {
    // Skip cache for streaming
    if (request.stream) {
      return this.client.createChatCompletion(request);
    }

    // Try cache first
    const cached = await this.cache.get(request.messages);
    if (cached) {
      return {
        ...cached,
        id: `cached-${cached.id}`,
      };
    }

    // Cache miss - call LLM
    const response = await this.client.createChatCompletion(request);

    // Store in cache
    await this.cache.set(request.messages, response);

    return response;
  }

  createStreamingChatCompletion(request: ChatCompletionRequest) {
    // Streaming doesn't use cache
    return this.client.createStreamingChatCompletion(request);
  }

  calculateCost(promptTokens: number, completionTokens: number) {
    return this.client.calculateCost(promptTokens, completionTokens);
  }
}
```

### 4.4 Usage Example

Create `packages/llm/src/examples/semantic-caching.ts`:

```typescript
import { createCacheClient } from '@kit/cache';
import { createLLMClient } from '../factory';
import { SemanticCache } from '../cache/semantic-cache';
import { CachedLLMClient } from '../cache/cached-llm-client';

async function example() {
  // Create cache
  const cache = createCacheClient({
    provider: 'redis',
    redis: {
      url: process.env.REDIS_URL!,
    },
  });

  // Create semantic cache
  const semanticCache = new SemanticCache({
    cache,
    embeddingApiKey: process.env.OPENAI_API_KEY!,
    similarityThreshold: 0.90, // 90% similarity
    ttlSeconds: 3600, // 1 hour
  });

  // Create LLM client with caching
  const baseLLM = createLLMClient({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  });

  const llm = new CachedLLMClient(baseLLM, semanticCache);

  // First call - cache miss
  console.log('Query 1: What is the capital of France?');
  const response1 = await llm.createChatCompletion({
    messages: [
      { role: 'user', content: 'What is the capital of France?' },
    ],
  });
  console.log('Response:', response1.message.content);
  console.log('Cost:', response1.cost?.total);

  // Similar query - should hit cache
  console.log('\nQuery 2: Tell me the capital city of France');
  const response2 = await llm.createChatCompletion({
    messages: [
      { role: 'user', content: 'Tell me the capital city of France' },
    ],
  });
  console.log('Response:', response2.message.content);
  console.log('Cost:', response2.cost?.total);
  console.log('Cached:', response2.id.startsWith('cached-'));

  // Different query - cache miss
  console.log('\nQuery 3: What is the capital of Germany?');
  const response3 = await llm.createChatCompletion({
    messages: [
      { role: 'user', content: 'What is the capital of Germany?' },
    ],
  });
  console.log('Response:', response3.message.content);
  console.log('Cost:', response3.cost?.total);

  // Stats
  const stats = await semanticCache.getStats();
  console.log('\nCache stats:', stats);

  await cache.disconnect();
}

example();
```

---

## 5. Prompt Templating & Library

### Overview

A comprehensive prompt management system that transforms the base SaaS into a **prompt engineering platform**. Following industry best practices from PromptLayer, LangChain, and leading AI companies, this system provides:

- 📝 **Template Management**: Create, version, and organize reusable prompt templates
- 🔄 **Variable Substitution**: Type-safe dynamic variable replacement
- 📊 **Performance Tracking**: Monitor costs, quality ratings, and usage metrics
- 🔀 **A/B Testing**: Test different prompt versions with traffic splitting
- 🎯 **Release Labels**: Manage deployments with prod/staging/dev labels
- 🤝 **Collaboration**: Share templates across teams with comments
- 📚 **Pre-built Library**: Industry-standard templates for common use cases

### 5.1 Database Schema

Create `apps/web/supabase/schemas/20-prompt-templates.sql`:

```sql
-- ==================================
-- Prompt Templates Schema
-- ==================================
-- Enterprise-grade prompt management system
-- Supports versioning, A/B testing, and performance tracking
-- Following PromptLayer and LangChain best practices

-- Prompt template categories
create type public.prompt_category as enum (
  'content_generation',
  'customer_support',
  'data_analysis',
  'code_generation',
  'marketing',
  'sales',
  'research',
  'translation',
  'summarization',
  'question_answering'
);

-- Variable data types
create type public.template_variable_type as enum (
  'string',
  'number',
  'boolean',
  'array',
  'object',
  'text',      -- Multi-line string
  'select',    -- Dropdown selection
  'multiselect' -- Multiple selections
);

-- Release label types (for version management)
create type public.release_label as enum (
  'prod',
  'staging',
  'dev',
  'test',
  'experimental'
);

-- Prompt templates table
create table if not exists public.prompt_templates (
  id uuid unique not null default extensions.uuid_generate_v4(),

  -- Ownership
  account_id uuid references public.accounts(id) on delete cascade,  -- null = system template
  is_system boolean default false not null,  -- System templates shared across all accounts

  -- Template identity
  name varchar(255) not null,
  slug varchar(255) not null,  -- URL-friendly unique identifier
  description text,
  category public.prompt_category not null,

  -- Template content
  template_content text not null,  -- Template with {{variable}} placeholders
  variables jsonb default '[]'::jsonb,  -- Variable definitions

  -- Versioning
  version integer default 1 not null,
  parent_version_id uuid references public.prompt_templates(id) on delete set null,
  release_label public.release_label default 'dev',
  commit_message text,  -- Describe what changed in this version

  -- Status
  status varchar(50) default 'draft' not null check (status in ('draft', 'active', 'archived')),

  -- Usage tracking
  usage_count integer default 0 not null,
  last_used_at timestamp with time zone,

  -- Performance metrics (aggregated from usage logs)
  avg_cost decimal(10, 6),
  avg_rating decimal(3, 2),  -- 0-5 stars
  avg_latency_ms integer,

  -- Metadata
  tags text[] default '{}',
  metadata jsonb default '{}'::jsonb,

  -- Audit fields
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  created_by uuid references auth.users,
  updated_by uuid references auth.users,

  primary key (id),
  unique (account_id, slug, version),
  unique (account_id, slug, release_label) where status = 'active'
);

-- Indexes for performance
create index if not exists ix_prompt_templates_account_id on public.prompt_templates (account_id);
create index if not exists ix_prompt_templates_category on public.prompt_templates (category);
create index if not exists ix_prompt_templates_slug on public.prompt_templates (account_id, slug);
create index if not exists ix_prompt_templates_status on public.prompt_templates (status) where status = 'active';
create index if not exists ix_prompt_templates_system on public.prompt_templates (is_system) where is_system = true;
create index if not exists ix_prompt_templates_release on public.prompt_templates (release_label);

-- GIN indexes for JSONB and array queries
create index if not exists ix_prompt_templates_variables on public.prompt_templates using gin (variables);
create index if not exists ix_prompt_templates_tags on public.prompt_templates using gin (tags);
create index if not exists ix_prompt_templates_metadata on public.prompt_templates using gin (metadata);

-- Timestamps and audit trail
create trigger prompt_templates_set_timestamps
before insert or update on public.prompt_templates
for each row execute function public.trigger_set_timestamps();

create trigger prompt_templates_set_user_tracking
before insert or update on public.prompt_templates
for each row execute function public.trigger_set_user_tracking();

-- Prompt template usage logs
create table if not exists public.prompt_usage_logs (
  id uuid unique not null default extensions.uuid_generate_v4(),

  -- Template reference
  template_id uuid references public.prompt_templates(id) on delete cascade not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null,

  -- Execution details
  rendered_prompt text not null,  -- Final prompt after variable substitution
  variables_used jsonb default '{}'::jsonb,  -- Actual variable values used

  -- LLM details
  llm_provider varchar(50),
  llm_model varchar(255),

  -- Results
  response_text text,
  tokens_used integer,
  cost decimal(10, 6),
  latency_ms integer,

  -- Quality feedback
  rating integer check (rating >= 1 and rating <= 5),
  feedback text,

  -- Status
  success boolean default true,
  error_message text,

  -- Timestamp
  created_at timestamp with time zone default now() not null,

  primary key (id)
);

-- Indexes for usage logs
create index if not exists ix_prompt_usage_logs_template_id on public.prompt_usage_logs (template_id, created_at desc);
create index if not exists ix_prompt_usage_logs_account_id on public.prompt_usage_logs (account_id, created_at desc);
create index if not exists ix_prompt_usage_logs_user_id on public.prompt_usage_logs (user_id, created_at desc);
create index if not exists ix_prompt_usage_logs_created_at on public.prompt_usage_logs (created_at desc);

-- Template comments (collaboration)
create table if not exists public.prompt_template_comments (
  id uuid unique not null default extensions.uuid_generate_v4(),
  template_id uuid references public.prompt_templates(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete set null not null,
  parent_comment_id uuid references public.prompt_template_comments(id) on delete cascade,  -- For threading

  comment_text text not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone,

  primary key (id)
);

create index if not exists ix_prompt_comments_template on public.prompt_template_comments (template_id, created_at desc);

-- ==================================
-- RLS Policies
-- ==================================

-- Prompt templates policies
alter table public.prompt_templates enable row level security;

revoke all on public.prompt_templates from authenticated, service_role;
grant select, insert, update, delete on table public.prompt_templates to authenticated;

-- Read: Users can see system templates + their account templates
create policy "prompt_templates_read" on public.prompt_templates for select
  to authenticated using (
    is_system = true  -- System templates visible to all
    or account_id is null  -- Global templates
    or public.has_role_on_account(account_id)  -- Account templates
  );

-- Create: Users can create templates in their accounts
create policy "prompt_templates_create" on public.prompt_templates for insert
  to authenticated with check (
    (account_id is not null and public.has_role_on_account(account_id))
    or (is_system = false and account_id is null)  -- Personal templates
  );

-- Update: Users can update their account templates
create policy "prompt_templates_update" on public.prompt_templates for update
  to authenticated using (
    account_id is not null
    and public.has_role_on_account(account_id)
    and is_system = false  -- Cannot modify system templates
  );

-- Delete: Users can delete their account templates
create policy "prompt_templates_delete" on public.prompt_templates for delete
  to authenticated using (
    account_id is not null
    and public.has_role_on_account(account_id)
    and is_system = false
  );

-- Usage logs policies
alter table public.prompt_usage_logs enable row level security;

revoke all on public.prompt_usage_logs from authenticated, service_role;
grant select, insert on table public.prompt_usage_logs to authenticated;

create policy "prompt_usage_logs_read" on public.prompt_usage_logs for select
  to authenticated using (
    public.has_role_on_account(account_id)
  );

create policy "prompt_usage_logs_create" on public.prompt_usage_logs for insert
  to authenticated with check (
    user_id = auth.uid()
    and public.has_role_on_account(account_id)
  );

-- Comments policies
alter table public.prompt_template_comments enable row level security;

revoke all on public.prompt_template_comments from authenticated, service_role;
grant select, insert, update, delete on table public.prompt_template_comments to authenticated;

create policy "prompt_comments_read" on public.prompt_template_comments for select
  to authenticated using (
    exists (
      select 1 from public.prompt_templates
      where id = prompt_template_comments.template_id
      and (is_system = true or public.has_role_on_account(account_id))
    )
  );

create policy "prompt_comments_create" on public.prompt_template_comments for insert
  to authenticated with check (user_id = auth.uid());

create policy "prompt_comments_update" on public.prompt_template_comments for update
  to authenticated using (user_id = auth.uid());

create policy "prompt_comments_delete" on public.prompt_template_comments for delete
  to authenticated using (user_id = auth.uid());

-- ==================================
-- Helper Functions
-- ==================================

-- Get template by slug and release label
create or replace function public.get_prompt_template(
  p_slug varchar(255),
  p_account_id uuid default null,
  p_release_label public.release_label default 'prod'
) returns public.prompt_templates
language sql
security invoker
set search_path = '' as $$
  select *
  from public.prompt_templates
  where slug = p_slug
    and status = 'active'
    and release_label = p_release_label
    and (
      is_system = true
      or account_id = p_account_id
      or (account_id is null and is_system = false)  -- Personal templates
    )
  order by version desc
  limit 1;
$$;

grant execute on function public.get_prompt_template(varchar, uuid, public.release_label) to authenticated;

-- Render template with variables
create or replace function public.render_prompt_template(
  p_template_id uuid,
  p_variables jsonb
) returns text
language plpgsql
security invoker
set search_path = '' as $$
declare
  v_template_content text;
  v_variables jsonb;
  v_key text;
  v_value text;
  v_result text;
begin
  -- Get template content
  select template_content into v_template_content
  from public.prompt_templates
  where id = p_template_id;

  if v_template_content is null then
    raise exception 'Template not found: %', p_template_id;
  end if;

  v_result := v_template_content;

  -- Replace each variable
  for v_key, v_value in select * from jsonb_each_text(p_variables)
  loop
    v_result := replace(v_result, '{{' || v_key || '}}', v_value);
  end loop;

  return v_result;
end;
$$;

grant execute on function public.render_prompt_template(uuid, jsonb) to authenticated;

-- Log template usage
create or replace function public.log_prompt_usage(
  p_template_id uuid,
  p_account_id uuid,
  p_rendered_prompt text,
  p_variables_used jsonb,
  p_llm_provider varchar(50),
  p_llm_model varchar(255),
  p_response_text text default null,
  p_tokens_used integer default null,
  p_cost decimal(10, 6) default null,
  p_latency_ms integer default null,
  p_success boolean default true,
  p_error_message text default null
) returns uuid
language plpgsql
security invoker
set search_path = '' as $$
declare
  v_log_id uuid;
  v_user_id uuid;
begin
  select auth.uid() into v_user_id;

  insert into public.prompt_usage_logs (
    template_id,
    account_id,
    user_id,
    rendered_prompt,
    variables_used,
    llm_provider,
    llm_model,
    response_text,
    tokens_used,
    cost,
    latency_ms,
    success,
    error_message
  ) values (
    p_template_id,
    p_account_id,
    v_user_id,
    p_rendered_prompt,
    p_variables_used,
    p_llm_provider,
    p_llm_model,
    p_response_text,
    p_tokens_used,
    p_cost,
    p_latency_ms,
    p_success,
    p_error_message
  )
  returning id into v_log_id;

  -- Update template usage stats
  update public.prompt_templates
  set
    usage_count = usage_count + 1,
    last_used_at = now()
  where id = p_template_id;

  return v_log_id;
end;
$$;

grant execute on function public.log_prompt_usage(uuid, uuid, text, jsonb, varchar, varchar, text, integer, decimal, integer, boolean, text) to authenticated;

-- Clone template (for versioning)
create or replace function public.clone_prompt_template(
  p_template_id uuid,
  p_commit_message text default null
) returns uuid
language plpgsql
security invoker
set search_path = '' as $$
declare
  v_new_id uuid;
  v_new_version integer;
  v_template record;
begin
  -- Get original template
  select * into v_template
  from public.prompt_templates
  where id = p_template_id;

  if v_template is null then
    raise exception 'Template not found: %', p_template_id;
  end if;

  -- Calculate new version number
  select coalesce(max(version), 0) + 1 into v_new_version
  from public.prompt_templates
  where account_id = v_template.account_id
    and slug = v_template.slug;

  -- Create new version
  insert into public.prompt_templates (
    account_id,
    is_system,
    name,
    slug,
    description,
    category,
    template_content,
    variables,
    version,
    parent_version_id,
    release_label,
    commit_message,
    status,
    tags,
    metadata
  ) values (
    v_template.account_id,
    v_template.is_system,
    v_template.name,
    v_template.slug,
    v_template.description,
    v_template.category,
    v_template.template_content,
    v_template.variables,
    v_new_version,
    p_template_id,
    'dev',  -- New versions start in dev
    p_commit_message,
    'draft',  -- New versions start as draft
    v_template.tags,
    v_template.metadata
  )
  returning id into v_new_id;

  return v_new_id;
end;
$$;

grant execute on function public.clone_prompt_template(uuid, text) to authenticated;

-- Get template performance metrics
create or replace function public.get_template_metrics(
  p_template_id uuid,
  p_days integer default 30
) returns table (
  total_uses bigint,
  avg_cost numeric,
  avg_rating numeric,
  avg_latency_ms numeric,
  success_rate numeric,
  unique_users bigint
)
language sql
security invoker
set search_path = '' as $$
  select
    count(*)::bigint as total_uses,
    avg(cost) as avg_cost,
    avg(rating) as avg_rating,
    avg(latency_ms) as avg_latency_ms,
    (count(*) filter (where success = true)::numeric / nullif(count(*), 0) * 100) as success_rate,
    count(distinct user_id)::bigint as unique_users
  from public.prompt_usage_logs
  where template_id = p_template_id
    and created_at > now() - interval '1 day' * p_days;
$$;

grant execute on function public.get_template_metrics(uuid, integer) to authenticated;
```

### 5.2 TypeScript Types

Create `packages/features/prompt-templates/src/lib/types.ts`:

```typescript
import type { Database } from '@kit/supabase/database';

export type PromptTemplate = Database['public']['Tables']['prompt_templates']['Row'];
export type PromptTemplateInsert = Database['public']['Tables']['prompt_templates']['Insert'];
export type PromptTemplateUpdate = Database['public']['Tables']['prompt_templates']['Update'];

export type PromptUsageLog = Database['public']['Tables']['prompt_usage_logs']['Row'];
export type PromptTemplateComment = Database['public']['Tables']['prompt_template_comments']['Row'];

export type PromptCategory = Database['public']['Enums']['prompt_category'];
export type TemplateVariableType = Database['public']['Enums']['template_variable_type'];
export type ReleaseLabel = Database['public']['Enums']['release_label'];

/**
 * Template variable definition
 */
export interface TemplateVariable {
  name: string;
  type: TemplateVariableType;
  label: string;
  description?: string;
  required: boolean;
  default_value?: unknown;
  options?: string[];  // For select/multiselect types
  validation?: {
    min?: number;
    max?: number;
    pattern?: string;
  };
}

/**
 * Rendered prompt result
 */
export interface RenderedPrompt {
  content: string;
  variables_used: Record<string, unknown>;
  template_id: string;
  template_name: string;
}

/**
 * Template performance metrics
 */
export interface TemplateMetrics {
  total_uses: number;
  avg_cost: number;
  avg_rating: number;
  avg_latency_ms: number;
  success_rate: number;
  unique_users: number;
}

/**
 * Template with usage stats
 */
export interface PromptTemplateWithMetrics extends PromptTemplate {
  metrics?: TemplateMetrics;
}
```

### 5.3 Zod Schemas

Create `packages/features/prompt-templates/src/lib/schemas/template.schema.ts`:

```typescript
import { z } from 'zod';

export const TemplateVariableSchema = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Must be valid identifier'),
  type: z.enum(['string', 'number', 'boolean', 'array', 'object', 'text', 'select', 'multiselect']),
  label: z.string().min(1),
  description: z.string().optional(),
  required: z.boolean().default(false),
  default_value: z.unknown().optional(),
  options: z.array(z.string()).optional(),
  validation: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
    pattern: z.string().optional(),
  }).optional(),
});

export const CreateTemplateSchema = z.object({
  accountId: z.string().uuid().nullable(),
  name: z.string().min(1).max(255),
  slug: z.string().min(3).max(255).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase with hyphens'),
  description: z.string().optional(),
  category: z.enum([
    'content_generation',
    'customer_support',
    'data_analysis',
    'code_generation',
    'marketing',
    'sales',
    'research',
    'translation',
    'summarization',
    'question_answering',
  ]),
  template_content: z.string().min(1),
  variables: z.array(TemplateVariableSchema).default([]),
  tags: z.array(z.string()).default([]),
  release_label: z.enum(['prod', 'staging', 'dev', 'test', 'experimental']).default('dev'),
});

export const UpdateTemplateSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  category: z.enum([
    'content_generation',
    'customer_support',
    'data_analysis',
    'code_generation',
    'marketing',
    'sales',
    'research',
    'translation',
    'summarization',
    'question_answering',
  ]).optional(),
  template_content: z.string().min(1).optional(),
  variables: z.array(TemplateVariableSchema).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  release_label: z.enum(['prod', 'staging', 'dev', 'test', 'experimental']).optional(),
});

export const RenderTemplateSchema = z.object({
  templateId: z.string().uuid(),
  variables: z.record(z.unknown()),
});

export const LogUsageSchema = z.object({
  templateId: z.string().uuid(),
  accountId: z.string().uuid(),
  variables_used: z.record(z.unknown()),
  llm_provider: z.string(),
  llm_model: z.string(),
  response_text: z.string().optional(),
  tokens_used: z.number().optional(),
  cost: z.number().optional(),
  latency_ms: z.number().optional(),
  success: z.boolean().default(true),
  error_message: z.string().optional(),
});

export const RateTemplateSchema = z.object({
  usageLogId: z.string().uuid(),
  rating: z.number().min(1).max(5),
  feedback: z.string().optional(),
});
```

### 5.4 Template Engine

Create `packages/features/prompt-templates/src/lib/engine.ts`:

```typescript
import type { TemplateVariable } from './types';
import { z } from 'zod';

/**
 * Extract variables from template content
 * Finds all {{variable}} patterns
 */
export function extractVariables(templateContent: string): string[] {
  const regex = /\{\{(\w+)\}\}/g;
  const variables = new Set<string>();

  let match;
  while ((match = regex.exec(templateContent)) !== null) {
    variables.add(match[1]!);
  }

  return Array.from(variables);
}

/**
 * Validate variables against template
 */
export function validateVariables(
  templateContent: string,
  variables: TemplateVariable[],
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const templateVars = extractVariables(templateContent);
  const definedVars = new Set(variables.map((v) => v.name));

  // Check for undefined variables in template
  for (const varName of templateVars) {
    if (!definedVars.has(varName)) {
      errors.push(`Variable '${varName}' used in template but not defined`);
    }
  }

  // Check for unused variable definitions
  for (const variable of variables) {
    if (!templateVars.includes(variable.name)) {
      errors.push(`Variable '${variable.name}' defined but not used in template`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generate Zod schema from template variables
 */
export function generateValidationSchema(variables: TemplateVariable[]): z.ZodObject<any> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const variable of variables) {
    let schema: z.ZodTypeAny;

    switch (variable.type) {
      case 'string':
      case 'text':
        schema = z.string();
        if (variable.validation?.min) {
          schema = (schema as z.ZodString).min(variable.validation.min);
        }
        if (variable.validation?.max) {
          schema = (schema as z.ZodString).max(variable.validation.max);
        }
        if (variable.validation?.pattern) {
          schema = (schema as z.ZodString).regex(new RegExp(variable.validation.pattern));
        }
        break;

      case 'number':
        schema = z.number();
        if (variable.validation?.min !== undefined) {
          schema = (schema as z.ZodNumber).min(variable.validation.min);
        }
        if (variable.validation?.max !== undefined) {
          schema = (schema as z.ZodNumber).max(variable.validation.max);
        }
        break;

      case 'boolean':
        schema = z.boolean();
        break;

      case 'array':
        schema = z.array(z.unknown());
        break;

      case 'object':
        schema = z.record(z.unknown());
        break;

      case 'select':
        schema = variable.options ? z.enum(variable.options as [string, ...string[]]) : z.string();
        break;

      case 'multiselect':
        schema = z.array(z.string());
        break;

      default:
        schema = z.unknown();
    }

    // Apply optional/required
    if (!variable.required) {
      schema = schema.optional();
      if (variable.default_value !== undefined) {
        schema = schema.default(variable.default_value);
      }
    }

    shape[variable.name] = schema;
  }

  return z.object(shape);
}

/**
 * Render template with variables
 */
export function renderTemplate(
  templateContent: string,
  variables: Record<string, unknown>,
): string {
  let result = templateContent;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = String(value ?? '');
    result = result.replace(new RegExp(placeholder, 'g'), replacement);
  }

  return result;
}

/**
 * Validate and render template
 */
export function validateAndRender(
  templateContent: string,
  templateVariables: TemplateVariable[],
  providedVariables: Record<string, unknown>,
): { success: boolean; rendered?: string; errors?: string[] } {
  try {
    // Generate validation schema
    const schema = generateValidationSchema(templateVariables);

    // Validate provided variables
    const validation = schema.safeParse(providedVariables);

    if (!validation.success) {
      return {
        success: false,
        errors: validation.error.issues.map((issue) =>
          `${issue.path.join('.')}: ${issue.message}`
        ),
      };
    }

    // Render template
    const rendered = renderTemplate(templateContent, validation.data);

    return {
      success: true,
      rendered,
    };
  } catch (error) {
    return {
      success: false,
      errors: [error instanceof Error ? error.message : 'Unknown error'],
    };
  }
}
```

### 5.5 Server Functions

Create `packages/features/prompt-templates/src/lib/server/template.mutations.ts`:

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { revalidatePath } from 'next/cache';

import {
  CreateTemplateSchema,
  UpdateTemplateSchema,
  RenderTemplateSchema,
  LogUsageSchema,
  RateTemplateSchema,
} from '../schemas/template.schema';

/**
 * Create prompt template
 */
export const createPromptTemplateAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { data: template, error } = await supabase
      .from('prompt_templates')
      .insert({
        account_id: data.accountId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        category: data.category,
        template_content: data.template_content,
        variables: data.variables,
        tags: data.tags,
        release_label: data.release_label,
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create template: ${error.message}`);
    }

    revalidatePath('/home/[account]/prompts', 'layout');

    return { data: template };
  },
  {
    schema: CreateTemplateSchema,
    auth: true,
  },
);

/**
 * Update prompt template
 */
export const updatePromptTemplateAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { templateId, ...updates } = data;

    const { data: template, error } = await supabase
      .from('prompt_templates')
      .update(updates)
      .eq('id', templateId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update template: ${error.message}`);
    }

    revalidatePath(`/home/[account]/prompts/${templateId}`, 'page');

    return { data: template };
  },
  {
    schema: UpdateTemplateSchema,
    auth: true,
  },
);

/**
 * Clone template (create new version)
 */
export const clonePromptTemplateAction = enhanceAction(
  async (data: { templateId: string; commitMessage?: string }) => {
    const supabase = getSupabaseServerClient();

    const { data: newTemplateId, error } = await supabase.rpc('clone_prompt_template', {
      p_template_id: data.templateId,
      p_commit_message: data.commitMessage ?? null,
    });

    if (error) {
      throw new Error(`Failed to clone template: ${error.message}`);
    }

    revalidatePath('/home/[account]/prompts', 'layout');

    return { data: { id: newTemplateId } };
  },
  {
    auth: true,
  },
);

/**
 * Render template with variables
 */
export const renderPromptTemplateAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { data: rendered, error } = await supabase.rpc('render_prompt_template', {
      p_template_id: data.templateId,
      p_variables: data.variables,
    });

    if (error) {
      throw new Error(`Failed to render template: ${error.message}`);
    }

    return { data: { rendered } };
  },
  {
    schema: RenderTemplateSchema,
    auth: true,
  },
);

/**
 * Log template usage
 */
export const logPromptUsageAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    // First render the template
    const { data: rendered, error: renderError } = await supabase.rpc('render_prompt_template', {
      p_template_id: data.templateId,
      p_variables: data.variables_used,
    });

    if (renderError) {
      throw new Error(`Failed to render template: ${renderError.message}`);
    }

    // Log the usage
    const { data: logId, error } = await supabase.rpc('log_prompt_usage', {
      p_template_id: data.templateId,
      p_account_id: data.accountId,
      p_rendered_prompt: rendered,
      p_variables_used: data.variables_used,
      p_llm_provider: data.llm_provider,
      p_llm_model: data.llm_model,
      p_response_text: data.response_text ?? null,
      p_tokens_used: data.tokens_used ?? null,
      p_cost: data.cost ?? null,
      p_latency_ms: data.latency_ms ?? null,
      p_success: data.success,
      p_error_message: data.error_message ?? null,
    });

    if (error) {
      throw new Error(`Failed to log usage: ${error.message}`);
    }

    return { data: { logId } };
  },
  {
    schema: LogUsageSchema,
    auth: true,
  },
);

/**
 * Rate template usage
 */
export const rateTemplateUsageAction = enhanceAction(
  async (data) => {
    const supabase = getSupabaseServerClient();

    const { error } = await supabase
      .from('prompt_usage_logs')
      .update({
        rating: data.rating,
        feedback: data.feedback,
      })
      .eq('id', data.usageLogId);

    if (error) {
      throw new Error(`Failed to rate template: ${error.message}`);
    }

    return { data: { success: true } };
  },
  {
    schema: RateTemplateSchema,
    auth: true,
  },
);
```

Create `packages/features/prompt-templates/src/lib/server/template.queries.ts`:

```typescript
'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import type { PromptTemplate, PromptTemplateWithMetrics, TemplateMetrics } from '../types';

/**
 * Get all templates for account (including system templates)
 */
export async function getAccountTemplates(accountId: string | null): Promise<PromptTemplate[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('prompt_templates')
    .select('*')
    .or(`account_id.eq.${accountId},is_system.eq.true`)
    .eq('status', 'active')
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load templates: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Get template by slug and release label
 */
export async function getTemplateBySlug(
  slug: string,
  accountId: string | null,
  releaseLabel: 'prod' | 'staging' | 'dev' | 'test' | 'experimental' = 'prod',
): Promise<PromptTemplate | null> {
  const supabase = getSupabaseServerClient();

  const { data, error} = await supabase.rpc('get_prompt_template', {
    p_slug: slug,
    p_account_id: accountId,
    p_release_label: releaseLabel,
  });

  if (error) {
    throw new Error(`Failed to load template: ${error.message}`);
  }

  return data;
}

/**
 * Get template with metrics
 */
export async function getTemplateWithMetrics(
  templateId: string,
  days = 30,
): Promise<PromptTemplateWithMetrics | null> {
  const supabase = getSupabaseServerClient();

  // Get template
  const { data: template, error: templateError } = await supabase
    .from('prompt_templates')
    .select('*')
    .eq('id', templateId)
    .single();

  if (templateError || !template) {
    return null;
  }

  // Get metrics
  const { data: metrics, error: metricsError } = await supabase.rpc('get_template_metrics', {
    p_template_id: templateId,
    p_days: days,
  });

  if (metricsError) {
    return template;
  }

  return {
    ...template,
    metrics: metrics?.[0] as TemplateMetrics,
  };
}

/**
 * Get template versions
 */
export async function getTemplateVersions(
  accountId: string | null,
  slug: string,
): Promise<PromptTemplate[]> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from('prompt_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('slug', slug)
    .order('version', { ascending: false });

  if (error) {
    throw new Error(`Failed to load template versions: ${error.message}`);
  }

  return data ?? [];
}

/**
 * Search templates
 */
export async function searchTemplates(
  accountId: string | null,
  query: string,
  category?: string,
): Promise<PromptTemplate[]> {
  const supabase = getSupabaseServerClient();

  let queryBuilder = supabase
    .from('prompt_templates')
    .select('*')
    .or(`account_id.eq.${accountId},is_system.eq.true`)
    .eq('status', 'active')
    .or(`name.ilike.%${query}%,description.ilike.%${query}%,tags.cs.{${query}}`);

  if (category) {
    queryBuilder = queryBuilder.eq('category', category);
  }

  const { data, error } = await queryBuilder;

  if (error) {
    throw new Error(`Failed to search templates: ${error.message}`);
  }

  return data ?? [];
}
```

### 5.6 LLM Integration

Create `packages/llm/src/templates/integration.ts`:

```typescript
import type { LLMClient, ChatMessage, ChatCompletionRequest } from '../types';
import type { PromptTemplate } from '@kit/features/prompt-templates';
import { renderTemplate } from '@kit/features/prompt-templates/engine';

/**
 * Create chat completion from template
 */
export async function createCompletionFromTemplate(
  llmClient: LLMClient,
  template: PromptTemplate,
  variables: Record<string, unknown>,
  options?: Partial<ChatCompletionRequest>,
) {
  // Render template
  const rendered = renderTemplate(template.template_content, variables);

  // Create messages
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: rendered,
    },
  ];

  // Execute completion
  const startTime = Date.now();
  const response = await llmClient.createChatCompletion({
    messages,
    ...options,
  });
  const latency = Date.now() - startTime;

  return {
    response,
    latency,
    rendered_prompt: rendered,
  };
}

/**
 * Helper to use template with auto-logging
 */
export async function useTemplate(
  llmClient: LLMClient,
  template: PromptTemplate,
  variables: Record<string, unknown>,
  accountId: string,
  options?: Partial<ChatCompletionRequest>,
) {
  const result = await createCompletionFromTemplate(
    llmClient,
    template,
    variables,
    options,
  );

  // Log usage (import logPromptUsageAction here)
  // This would be done in the calling code to avoid circular dependencies

  return result;
}
```

### 5.7 Pre-built Templates (Seed Data)

Create `apps/web/supabase/seeds/prompt-templates.sql`:

```sql
-- ==================================
-- System Prompt Templates Library
-- ==================================
-- Pre-built templates for common use cases
-- Based on industry best practices

-- Blog Post Writer
insert into public.prompt_templates (
  is_system, name, slug, category, description,
  template_content, variables, status, release_label, version
) values (
  true,
  'Blog Post Writer',
  'blog-post-writer',
  'content_generation',
  'Generate engaging blog posts on any topic with customizable tone and length',
  'Write a comprehensive blog post about {{topic}}.

Tone: {{tone}}
Target length: {{length}} words
Target audience: {{audience}}

Requirements:
- Start with an attention-grabbing introduction
- Use clear headings and subheadings
- Include practical examples and actionable insights
- End with a strong conclusion and call-to-action

Focus on providing value to the reader and maintaining engagement throughout.',
  '[
    {"name": "topic", "type": "text", "label": "Topic", "required": true, "description": "The main topic of the blog post"},
    {"name": "tone", "type": "select", "label": "Tone", "required": true, "default_value": "professional", "options": ["professional", "casual", "friendly", "authoritative", "conversational"]},
    {"name": "length", "type": "number", "label": "Target Length (words)", "required": true, "default_value": 1000, "validation": {"min": 300, "max": 3000}},
    {"name": "audience", "type": "string", "label": "Target Audience", "required": true, "default_value": "general public"}
  ]'::jsonb,
  'active',
  'prod',
  1
);

-- Customer Support Email
insert into public.prompt_templates (
  is_system, name, slug, category, description,
  template_content, variables, status, release_label, version
) values (
  true,
  'Customer Support Email Response',
  'customer-support-email',
  'customer_support',
  'Generate professional and empathetic customer support email responses',
  'Write a customer support email response for the following inquiry:

Customer Issue: {{issue_description}}
Customer Sentiment: {{sentiment}}
Priority: {{priority}}

Guidelines:
- Acknowledge the customer''s concern with empathy
- Provide a clear solution or next steps
- Use professional yet friendly language
- Include relevant information: {{additional_context}}
- End with an offer for further assistance

Tone should be {{tone}} and solution-focused.',
  '[
    {"name": "issue_description", "type": "text", "label": "Issue Description", "required": true},
    {"name": "sentiment", "type": "select", "label": "Customer Sentiment", "required": true, "options": ["frustrated", "confused", "neutral", "satisfied"], "default_value": "neutral"},
    {"name": "priority", "type": "select", "label": "Priority", "required": true, "options": ["low", "medium", "high", "urgent"], "default_value": "medium"},
    {"name": "additional_context", "type": "text", "label": "Additional Context", "required": false},
    {"name": "tone", "type": "select", "label": "Response Tone", "required": true, "options": ["formal", "professional", "friendly", "empathetic"], "default_value": "professional"}
  ]'::jsonb,
  'active',
  'prod',
  1
);

-- Code Documentation Generator
insert into public.prompt_templates (
  is_system, name, slug, category, description,
  template_content, variables, status, release_label, version
) values (
  true,
  'Code Documentation Generator',
  'code-doc-generator',
  'code_generation',
  'Generate comprehensive documentation for code snippets',
  'Generate detailed documentation for the following {{language}} code:

```{{language}}
{{code}}
```

Documentation should include:
- Brief summary of what the code does
- Parameter descriptions (if applicable)
- Return value description (if applicable)
- Usage examples
- Any important notes or caveats

Format: {{format}}
Style: Clear, concise, and beginner-friendly',
  '[
    {"name": "language", "type": "select", "label": "Programming Language", "required": true, "options": ["JavaScript", "TypeScript", "Python", "Java", "Go", "Rust", "Ruby", "PHP"]},
    {"name": "code", "type": "text", "label": "Code Snippet", "required": true},
    {"name": "format", "type": "select", "label": "Documentation Format", "required": true, "options": ["Markdown", "JSDoc", "Docstring", "Javadoc"], "default_value": "Markdown"}
  ]'::jsonb,
  'active',
  'prod',
  1
);

-- Data Analysis Summary
insert into public.prompt_templates (
  is_system, name, slug, category, description,
  template_content, variables, status, release_label, version
) values (
  true,
  'Data Analysis Summary',
  'data-analysis-summary',
  'data_analysis',
  'Generate insights and summaries from data analysis results',
  'Analyze the following data and provide key insights:

Dataset Description: {{dataset_description}}
Analysis Type: {{analysis_type}}
Key Metrics: {{key_metrics}}

Raw Data:
{{data}}

Please provide:
1. Executive Summary (2-3 sentences)
2. Key Findings (bullet points)
3. Notable Trends or Patterns
4. Actionable Recommendations
5. Data Quality Notes (if applicable)

Focus on: {{focus_areas}}
Target audience: {{audience}}',
  '[
    {"name": "dataset_description", "type": "string", "label": "Dataset Description", "required": true},
    {"name": "analysis_type", "type": "select", "label": "Analysis Type", "required": true, "options": ["descriptive", "comparative", "trend", "correlation", "predictive"]},
    {"name": "key_metrics", "type": "string", "label": "Key Metrics", "required": true},
    {"name": "data", "type": "text", "label": "Data (CSV, JSON, or text)", "required": true},
    {"name": "focus_areas", "type": "string", "label": "Focus Areas", "required": false, "default_value": "overall trends and patterns"},
    {"name": "audience", "type": "select", "label": "Target Audience", "required": true, "options": ["technical", "executive", "general"], "default_value": "executive"}
  ]'::jsonb,
  'active',
  'prod',
  1
);

-- Marketing Email Campaign
insert into public.prompt_templates (
  is_system, name, slug, category, description,
  template_content, variables, status, release_label, version
) values (
  true,
  'Marketing Email Campaign',
  'marketing-email-campaign',
  'marketing',
  'Create compelling marketing email copy for campaigns',
  'Create a marketing email for our {{campaign_type}} campaign.

Product/Service: {{product_name}}
Key Value Proposition: {{value_proposition}}
Target Audience: {{target_audience}}
Campaign Goal: {{campaign_goal}}

Email Structure:
- Subject Line (compelling and clear)
- Pre-header text
- Opening hook
- Main message with benefits
- Social proof (if available): {{social_proof}}
- Clear call-to-action: {{cta_text}}
- Closing

Tone: {{tone}}
Length: {{length}}

Remember to:
- Focus on benefits, not just features
- Create urgency without being pushy
- Make the CTA stand out
- Keep it scannable with short paragraphs',
  '[
    {"name": "campaign_type", "type": "select", "label": "Campaign Type", "required": true, "options": ["product_launch", "promotional", "educational", "re-engagement", "seasonal"]},
    {"name": "product_name", "type": "string", "label": "Product/Service Name", "required": true},
    {"name": "value_proposition", "type": "text", "label": "Key Value Proposition", "required": true},
    {"name": "target_audience", "type": "string", "label": "Target Audience", "required": true},
    {"name": "campaign_goal", "type": "select", "label": "Campaign Goal", "required": true, "options": ["awareness", "consideration", "conversion", "retention"]},
    {"name": "social_proof", "type": "text", "label": "Social Proof (optional)", "required": false},
    {"name": "cta_text", "type": "string", "label": "Call-to-Action Text", "required": true, "default_value": "Get Started"},
    {"name": "tone", "type": "select", "label": "Tone", "required": true, "options": ["professional", "friendly", "enthusiastic", "urgent"], "default_value": "friendly"},
    {"name": "length", "type": "select", "label": "Email Length", "required": true, "options": ["short (100-150 words)", "medium (200-300 words)", "long (400+ words)"], "default_value": "medium (200-300 words)"}
  ]'::jsonb,
  'active',
  'prod',
  1
);
```

### 5.8 Usage Example

Create `packages/features/prompt-templates/src/examples/template-usage.ts`:

```typescript
import { createLLMClient } from '@kit/llm';
import { getTemplateBySlug } from '../lib/server/template.queries';
import { logPromptUsageAction } from '../lib/server/template.mutations';
import { validateAndRender } from '../lib/engine';

async function example() {
  // Get template
  const template = await getTemplateBySlug(
    'blog-post-writer',
    null,  // accountId for system templates
    'prod',
  );

  if (!template) {
    throw new Error('Template not found');
  }

  // Prepare variables
  const variables = {
    topic: 'The Future of AI in Healthcare',
    tone: 'professional',
    length: 1200,
    audience: 'healthcare professionals',
  };

  // Validate and render
  const result = validateAndRender(
    template.template_content,
    template.variables as any[],
    variables,
  );

  if (!result.success) {
    console.error('Validation errors:', result.errors);
    return;
  }

  // Create LLM client
  const llm = createLLMClient({
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: process.env.OPENAI_API_KEY!,
  });

  // Execute completion
  const startTime = Date.now();
  const response = await llm.createChatCompletion({
    messages: [{ role: 'user', content: result.rendered! }],
    temperature: 0.7,
  });
  const latency = Date.now() - startTime;

  console.log('Generated blog post:', response.message.content);
  console.log('Cost:', response.cost?.total);
  console.log('Latency:', latency, 'ms');

  // Log usage
  await logPromptUsageAction({
    templateId: template.id,
    accountId: 'your-account-id',
    variables_used: variables,
    llm_provider: 'openai',
    llm_model: 'gpt-4o-mini',
    response_text: response.message.content,
    tokens_used: response.usage.totalTokens,
    cost: response.cost?.total,
    latency_ms: latency,
    success: true,
  });
}

example();
```

---

## 6. Migration Guide

### 5.1 Database Migrations

```bash
# Step 1: Create migration for projects schema
pnpm --filter web supabase:db:diff -f create-projects-schema

# Step 2: Create migration for audit logs schema
pnpm --filter web supabase:db:diff -f create-audit-logs-schema

# Step 3: Apply migrations
pnpm --filter web supabase migration up

# Alternative: Reset database with all schemas
pnpm supabase:web:reset

# Step 4: Generate TypeScript types
pnpm supabase:web:typegen
```

### 5.2 Package Installation

```bash
# Install LLM dependencies
pnpm add openai @anthropic-ai/sdk

# Install dev dependencies for testing
pnpm add -D @types/node
```

### 5.3 Environment Variables

Add to `.env.local`:

```bash
# LLM Configuration
LLM_PROVIDER=openai # or anthropic, gemini, etc.
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...

# OpenAI (for embeddings)
OPENAI_API_KEY=sk-...

# Anthropic
ANTHROPIC_API_KEY=sk-ant-...

# Cache
REDIS_URL=redis://localhost:6379
```

### 5.4 Package.json Updates

Create `packages/llm/package.json`:

```json
{
  "name": "@kit/llm",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/server.ts",
    "./cache": "./src/cache/index.ts"
  },
  "dependencies": {
    "openai": "^4.63.0",
    "@anthropic-ai/sdk": "^0.30.0",
    "@kit/cache": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.3"
  }
}
```

Create `packages/features/projects/package.json`:

```json
{
  "name": "@kit/features/projects",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./server": "./src/lib/server/index.ts",
    "./components": "./src/components/index.ts"
  },
  "dependencies": {
    "@kit/supabase": "workspace:*",
    "@kit/next": "workspace:*",
    "@kit/ui": "workspace:*",
    "react": "^19.0.0",
    "react-hook-form": "^7.53.2",
    "@hookform/resolvers": "^3.9.1",
    "zod": "^3.23.8"
  }
}
```

---

## 6. Testing Strategy

### 6.1 Projects Tests

Create `packages/features/projects/src/__tests__/project-queries.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getAccountProjects, getProject } from '../lib/server/project.queries';

describe('Project Queries', () => {
  let testAccountId: string;
  let testProjectId: string;

  beforeAll(async () => {
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup test data
  });

  it('should get account projects', async () => {
    const projects = await getAccountProjects(testAccountId);
    expect(projects).toBeInstanceOf(Array);
  });

  it('should get single project', async () => {
    const project = await getProject(testProjectId);
    expect(project).toBeDefined();
    expect(project?.id).toBe(testProjectId);
  });
});
```

### 6.2 Audit Logs Tests

Create `packages/features/audit-logs/src/__tests__/audit-log.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createAuditLog, getAuditLogs } from '../lib/server';

describe('Audit Logs', () => {
  it('should create audit log', async () => {
    const logId = await createAuditLog({
      accountId: 'test-account-id',
      action: 'created',
      objectType: 'project',
      objectId: 'test-project-id',
      objectName: 'Test Project',
    });

    expect(logId).toBeDefined();
  });

  it('should retrieve audit logs', async () => {
    const logs = await getAuditLogs({
      accountId: 'test-account-id',
      limit: 10,
    });

    expect(logs).toBeInstanceOf(Array);
  });
});
```

### 6.3 LLM Tests

Create `packages/llm/src/__tests__/llm-client.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createLLMClient } from '../factory';

describe('LLM Client', () => {
  it('should create OpenAI client', () => {
    const client = createLLMClient({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
    });

    expect(client.getProvider()).toBe('openai');
    expect(client.getModel()).toBe('gpt-4o-mini');
  });

  it('should calculate costs correctly', () => {
    const client = createLLMClient({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'test-key',
    });

    const cost = client.calculateCost(1000, 500);
    expect(cost.total).toBeGreaterThan(0);
  });
});
```

### 6.4 Semantic Cache Tests

Create `packages/llm/src/__tests__/semantic-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { cosineSimilarity } from '../cache/embeddings';

describe('Semantic Cache', () => {
  it('should calculate cosine similarity', () => {
    const vecA = [1, 0, 0];
    const vecB = [1, 0, 0];
    const similarity = cosineSimilarity(vecA, vecB);

    expect(similarity).toBe(1);
  });

  it('should calculate different vectors', () => {
    const vecA = [1, 0, 0];
    const vecB = [0, 1, 0];
    const similarity = cosineSimilarity(vecA, vecB);

    expect(similarity).toBe(0);
  });
});
```

### 6.5 Running Tests

```bash
# Run all tests
pnpm test

# Run specific package tests
pnpm --filter @kit/llm test
pnpm --filter @kit/features/projects test

# Run with coverage
pnpm test --coverage
```

---

## Appendix: Quick Reference

### Package Structure

```
packages/
├── llm/
│   ├── src/
│   │   ├── types.ts
│   │   ├── factory.ts
│   │   ├── providers/
│   │   │   ├── openai.ts
│   │   │   ├── anthropic.ts
│   │   │   └── gemini.ts
│   │   └── cache/
│   │       ├── embeddings.ts
│   │       ├── semantic-cache.ts
│   │       └── cached-llm-client.ts
│   └── package.json
├── features/
│   ├── projects/
│   │   ├── src/
│   │   │   ├── lib/
│   │   │   │   ├── types.ts
│   │   │   │   ├── schemas/
│   │   │   │   └── server/
│   │   │   └── components/
│   │   └── package.json
│   └── audit-logs/
│       ├── src/
│       │   ├── lib/
│       │   │   ├── types.ts
│       │   │   └── server/
│       │   └── components/
│       └── package.json
```

### Key Commands

```bash
# Database
pnpm supabase:web:reset
pnpm supabase:web:typegen
pnpm --filter web supabase:db:diff -f migration-name

# Development
pnpm dev
pnpm --filter web dev

# Quality
pnpm typecheck
pnpm lint:fix
pnpm format:fix
pnpm test
```

### Important Patterns

1. **Always enable RLS** on new tables
2. **Use server-side validation** with Zod schemas
3. **Audit log all mutations** for accountability
4. **Cache LLM responses** to reduce costs
5. **Parallel data fetching** for performance
6. **Type-safe database queries** with generated types

---

**End of Implementation Guide**

For questions or issues, please refer to the main project documentation or create an issue in the repository.
