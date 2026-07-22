create table if not exists public.template_versions (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  
  -- Template identity
  template_name varchar(255) not null,
  version_number integer not null,
  version_label varchar(100),
  
  -- Template content
  template_content jsonb not null,
  template_hash varchar(64) not null,
  
  -- Tracking
  is_active boolean not null default true,
  usage_count integer not null default 0,
  
  -- Performance aggregates (updated by analytics sync)
  performance_aggregate jsonb not null default '{}'::jsonb,
  
  notes text,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create unique index if not exists template_versions_account_template_number_idx on public.template_versions (account_id, template_name, version_number);
create unique index if not exists template_versions_active_idx on public.template_versions (account_id, template_name, project_id) where is_active = true;

create index if not exists template_versions_template_name_idx on public.template_versions (template_name);
create index if not exists template_versions_project_id_idx on public.template_versions (project_id);
create index if not exists template_versions_hash_idx on public.template_versions (template_hash);

create trigger template_versions_updated_at before update on public.template_versions
  for each row execute function public.handle_updated_at();

alter table public.template_versions enable row level security;
grant select, insert, update, delete on public.template_versions to authenticated, service_role;

create policy template_versions_select on public.template_versions
  for select using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy template_versions_insert on public.template_versions
  for insert with check (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy template_versions_update on public.template_versions
  for update using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy template_versions_delete on public.template_versions
  for delete using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));


create table if not exists public.episode_template_versions (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  template_version_id uuid not null references public.template_versions(id) on delete cascade,
  
  stage varchar(50) not null check (stage in ('story', 'screenplay', 'shot_list', 'dialogue', 'music', 'custom')),
  
  generated_at timestamp with time zone default now() not null,
  generation_params jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  
  unique(episode_id, template_version_id, stage)
);

alter table public.episode_template_versions enable row level security;
grant select, insert, update, delete on public.episode_template_versions to authenticated, service_role;

create policy episode_template_versions_select on public.episode_template_versions
  for select using (episode_id in (select id from public.episodes where account_id in (select account_id from public.accounts_memberships where user_id = auth.uid())));
create policy episode_template_versions_insert on public.episode_template_versions
  for insert with check (episode_id in (select id from public.episodes where account_id in (select account_id from public.accounts_memberships where user_id = auth.uid())));
create policy episode_template_versions_update on public.episode_template_versions
  for update using (episode_id in (select id from public.episodes where account_id in (select account_id from public.accounts_memberships where user_id = auth.uid())));
create policy episode_template_versions_delete on public.episode_template_versions
  for delete using (episode_id in (select id from public.episodes where account_id in (select account_id from public.accounts_memberships where user_id = auth.uid())));


create table if not exists public.sponsor_slots (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  episode_id uuid not null references public.episodes(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  
  -- Sponsor info
  brand_name varchar(255) not null,
  brand_logo_url text,
  campaign_name varchar(255),
  
  -- Slot positioning
  slot_type varchar(50) not null default 'mid_roll'
    check (slot_type in ('pre_roll', 'mid_roll', 'post_roll', 'dedicated', 'product_placement', 'overlay')),
  start_seconds decimal(10,2),
  end_seconds decimal(10,2),
  duration_seconds decimal(10,2),
  
  -- Financial
  rate_cents integer,
  rate_type varchar(50) default 'flat'
    check (rate_type in ('flat', 'cpm', 'cpc', 'revenue_share', 'barter')),
  currency varchar(3) default 'USD',
  is_paid boolean default false,
  paid_at timestamp with time zone,
  invoice_url text,
  
  -- Content
  talking_points text,
  script_text text,
  cta_url text,
  promo_code varchar(100),
  
  -- Tracking
  status varchar(50) not null default 'draft'
    check (status in ('draft', 'confirmed', 'recorded', 'published', 'completed', 'cancelled')),
  
  -- Performance
  click_count integer,
  conversion_count integer,
  
  metadata jsonb not null default '{}'::jsonb,
  
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create trigger sponsor_slots_updated_at before update on public.sponsor_slots
  for each row execute function public.handle_updated_at();

alter table public.sponsor_slots enable row level security;
grant select, insert, update, delete on public.sponsor_slots to authenticated, service_role;

create policy sponsor_slots_select on public.sponsor_slots
  for select using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy sponsor_slots_insert on public.sponsor_slots
  for insert with check (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy sponsor_slots_update on public.sponsor_slots
  for update using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
create policy sponsor_slots_delete on public.sponsor_slots
  for delete using (account_id in (select account_id from public.accounts_memberships where user_id = auth.uid()));
