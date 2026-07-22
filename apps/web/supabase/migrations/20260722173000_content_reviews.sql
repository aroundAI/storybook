create table if not exists public.content_reviews (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  publish_id uuid not null references public.publishes(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  
  -- Review type and timing
  review_type varchar(50) not null default 'day_30'
    check (review_type in ('day_7', 'day_30', 'day_90', 'custom')),
  review_due_at timestamp with time zone not null,
  
  -- Review status
  status varchar(50) not null default 'pending'
    check (status in ('pending', 'in_review', 'completed', 'skipped')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamp with time zone,
  
  -- Performance snapshot at review time
  performance_snapshot jsonb not null default '{}'::jsonb,
  -- Format: { views, likes, comments, shares, watchTimeSeconds, subscribersGained, revenueCents, retentionRate, ctr, impressions }
  
  -- Benchmarks comparison
  benchmarks jsonb not null default '{}'::jsonb,
  -- Format: { projectAvg: {...}, channelAvg: {...}, percentileRank: number }
  
  -- Review outcomes
  verdict varchar(50)
    check (verdict in ('outperforming', 'on_track', 'underperforming', 'needs_attention')),
  notes text,
  action_items jsonb not null default '[]'::jsonb,
  -- Format: [{ title: string, completed: boolean, assignedTo?: string }]
  
  -- AI-generated insights
  ai_insights jsonb,
  
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- Unique constraint
alter table public.content_reviews add constraint unique_publish_review_type unique(publish_id, review_type);

-- Indexes
create index if not exists content_reviews_account_id_idx on public.content_reviews (account_id);
create index if not exists content_reviews_publish_id_idx on public.content_reviews (publish_id);
create index if not exists content_reviews_project_id_idx on public.content_reviews (project_id);
create index if not exists content_reviews_status_idx on public.content_reviews (status);
create index if not exists content_reviews_review_due_at_idx on public.content_reviews (review_due_at);

-- RLS
alter table public.content_reviews enable row level security;

create policy "Select content_reviews" on public.content_reviews
  for select
  using (
    public.has_project_role(project_id, auth.uid(), 'viewer')
    or public.has_role_on_account(account_id)
  );

create policy "Insert content_reviews" on public.content_reviews
  for insert
  with check (
    public.has_project_role(project_id, auth.uid(), 'editor')
    or public.has_role_on_account(account_id)
  );

create policy "Update content_reviews" on public.content_reviews
  for update
  using (
    public.has_project_role(project_id, auth.uid(), 'editor')
    or public.has_role_on_account(account_id)
  );

create policy "Delete content_reviews" on public.content_reviews
  for delete
  using (
    public.has_project_role(project_id, auth.uid(), 'owner')
    or public.has_role_on_account(account_id)
  );

-- Triggers
create trigger content_reviews_updated_at
  before update on public.content_reviews
  for each row execute function public.handle_updated_at();

-- Grants
grant select, insert, update, delete on table public.content_reviews to authenticated;
grant select, insert, update, delete on table public.content_reviews to service_role;

-- Comments
comment on table public.content_reviews is 'Periodic content performance reviews (Day-7, Day-30, etc.)';
comment on column public.content_reviews.performance_snapshot is 'Snapshot of performance metrics at the time of review';
comment on column public.content_reviews.benchmarks is 'Comparative performance metrics vs project or channel averages';
comment on column public.content_reviews.action_items is 'JSON array of tasks associated with the review';
