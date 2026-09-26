-- ==================================
-- Manual Tasks Table
-- ==================================
-- Tracks manual steps that cannot be automated via APIs
-- Primary use: MLA audio track attachment in YouTube Studio

create table if not exists public.manual_tasks (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  publish_id uuid references public.publishes(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  
  -- Task classification
  task_type varchar(50) not null,
  priority varchar(20) default 'normal' not null,
  
  -- Task details
  title varchar(500) not null,
  instructions jsonb not null default '{}'::jsonb,
  
  -- Workflow  
  status varchar(50) default 'pending' not null,
  assigned_to uuid references auth.users(id) on delete set null,
  
  -- Tracking
  due_at timestamp with time zone,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  completed_by uuid references auth.users(id) on delete set null,
  notes text,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  
  check (task_type in ('mla_attachment', 'localized_thumbnail', 'end_screen', 'community_post', 'other')),
  check (priority in ('low', 'normal', 'high', 'urgent')),
  check (status in ('pending', 'in_progress', 'completed', 'skipped', 'blocked'))
);

comment on table public.manual_tasks is 'Tracks manual steps that cannot be automated via APIs (e.g. YouTube MLA)';
comment on column public.manual_tasks.task_type is 'Type of task: mla_attachment, localized_thumbnail, end_screen, community_post, other';
comment on column public.manual_tasks.status is 'Task status: pending, in_progress, completed, skipped, blocked';
comment on column public.manual_tasks.instructions is 'JSON containing context and step-by-step instructions for the operator';

-- Indexes for manual_tasks
create index if not exists idx_manual_tasks_account_id on public.manual_tasks(account_id);
create index if not exists idx_manual_tasks_publish_id on public.manual_tasks(publish_id);
create index if not exists idx_manual_tasks_episode_id on public.manual_tasks(episode_id);
create index if not exists idx_manual_tasks_status on public.manual_tasks(status);
create index if not exists idx_manual_tasks_task_type on public.manual_tasks(task_type);

-- Timestamps trigger for manual_tasks
create trigger manual_tasks_set_timestamps
before insert or update on public.manual_tasks
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- RLS Policies
-- ==================================

alter table public.manual_tasks enable row level security;
revoke all on public.manual_tasks from authenticated, service_role;
grant select, insert, update, delete on table public.manual_tasks to authenticated;

-- Uses has_account_access() helper function for cleaner, reusable authorization

create policy "manual_tasks_read" on public.manual_tasks for select
  to authenticated using (
    public.has_account_access(account_id)
  );

create policy "manual_tasks_create" on public.manual_tasks for insert
  to authenticated with check (
    public.has_account_access(account_id)
    -- KB-113: the video and episode must be the task's account's
    and public.publish_in_account(publish_id, account_id)
    and public.episode_in_account(episode_id, account_id)
  );

create policy "manual_tasks_update" on public.manual_tasks for update
  to authenticated using (
    public.has_account_access(account_id)
  )
  with check (
    public.has_account_access(account_id)
    and public.publish_in_account(publish_id, account_id)
    and public.episode_in_account(episode_id, account_id)
  );

create policy "manual_tasks_delete" on public.manual_tasks for delete
  to authenticated using (
    public.has_account_access(account_id)
  );
