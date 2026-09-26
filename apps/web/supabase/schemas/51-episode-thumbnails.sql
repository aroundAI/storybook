-- ==================================
-- Episode Thumbnails Table
-- ==================================
-- Language-specific thumbnails for episodes
-- Used when publishing to automatically select the correct thumbnail
-- Similar pattern to project_intros for language-agnostic design

create table if not exists public.episode_thumbnails (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  
  -- Language-agnostic: VARCHAR allows any language code without schema changes
  language varchar(10) not null,
  language_label varchar(100),
  
  -- Thumbnail data
  thumbnail_url text not null,
  file_name varchar(255),
  file_size_bytes bigint,
  mime_type varchar(100),
  width integer,
  height integer,
  
  -- Default flag for fallback
  is_default boolean default false,
  
  -- Audit fields
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  created_by uuid references auth.users(id) on delete set null,
  
  -- Unique constraint: one thumbnail per episode + language
  constraint episode_thumbnails_unique_language unique (episode_id, language)
);

-- Comments
comment on table public.episode_thumbnails is 'Language-specific thumbnails for episodes, used during publishing';
comment on column public.episode_thumbnails.language is 'ISO 639-1 language code (e.g., en, hi, es) or custom code';
comment on column public.episode_thumbnails.language_label is 'Human-readable language name (e.g., English, Hindi)';
comment on column public.episode_thumbnails.is_default is 'If true, this thumbnail is used as fallback when no language match';
comment on column public.episode_thumbnails.width is 'Thumbnail width in pixels';
comment on column public.episode_thumbnails.height is 'Thumbnail height in pixels';

-- Indexes
create index if not exists idx_episode_thumbnails_episode_id 
  on public.episode_thumbnails(episode_id);
create index if not exists idx_episode_thumbnails_language 
  on public.episode_thumbnails(episode_id, language);
create index if not exists idx_episode_thumbnails_default 
  on public.episode_thumbnails(episode_id, is_default) 
  where is_default = true;

-- Timestamps trigger
create trigger episode_thumbnails_set_timestamps
before insert or update on public.episode_thumbnails
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Row Level Security
-- ==================================

alter table public.episode_thumbnails enable row level security;

-- Revoke default permissions
revoke all on public.episode_thumbnails from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.episode_thumbnails to authenticated;

-- Read policy: anyone with access to the episode's project can read
create policy "episode_thumbnails_read" on public.episode_thumbnails for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = episode_thumbnails.episode_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or public.has_role_on_account(p.account_id)
      )
    )
  );

-- Create policy: project members can create
create policy "episode_thumbnails_create" on public.episode_thumbnails for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = episode_thumbnails.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- Update policy: project members can update
create policy "episode_thumbnails_update" on public.episode_thumbnails for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = episode_thumbnails.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- Delete policy: anyone who can write the project (owner, admin, member),
-- as for adding and replacing (KB-89, 20260926155852)
create policy "episode_thumbnails_delete" on public.episode_thumbnails for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      where e.id = episode_thumbnails.episode_id
      and public.can_write_project(e.project_id)
    )
  );
