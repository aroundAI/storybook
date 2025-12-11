-- ==================================
-- FILM-512: Multi-Language Dubbing Tables
-- ==================================
-- Adds dubbed_versions and dubbed_dialogue_lines tables for multi-language dubbing support

-- ==================================
-- Section: Dubbed Versions Table (FILM-512a)
-- ==================================
-- Tracks dubbing workflow per language for episodes

create table if not exists public.dubbed_versions (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  language varchar(10) not null,
  status varchar(50) default 'draft' not null,
  translation_status varchar(50) default 'pending' not null,
  voice_status varchar(50) default 'pending' not null,
  sync_status varchar(50) default 'pending' not null,
  final_video_url text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (status in ('draft', 'translating', 'voicing', 'syncing', 'ready', 'failed')),
  check (translation_status in ('pending', 'processing', 'completed', 'failed')),
  check (voice_status in ('pending', 'processing', 'completed', 'failed')),
  check (sync_status in ('pending', 'processing', 'completed', 'failed')),
  unique(episode_id, language)
);

comment on table public.dubbed_versions is 'Tracks dubbing workflow per language for episodes';
comment on column public.dubbed_versions.language is 'ISO 639-1 language code (en, es, fr, etc.)';
comment on column public.dubbed_versions.status is 'Overall dubbing status: draft, translating, voicing, syncing, ready, failed';
comment on column public.dubbed_versions.translation_status is 'Translation pipeline status';
comment on column public.dubbed_versions.voice_status is 'Voice generation pipeline status';
comment on column public.dubbed_versions.sync_status is 'Audio sync pipeline status';
comment on column public.dubbed_versions.metadata is 'Additional metadata (LLM costs, timing info, etc.)';

-- Indexes for dubbed_versions
create index if not exists idx_dubbed_versions_episode_id on public.dubbed_versions(episode_id);
create index if not exists idx_dubbed_versions_language on public.dubbed_versions(episode_id, language);
create index if not exists idx_dubbed_versions_status on public.dubbed_versions(status);

-- Timestamps trigger for dubbed_versions
create trigger dubbed_versions_set_timestamps
before insert or update on public.dubbed_versions
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Dubbed Dialogue Lines Table (FILM-512b)
-- ==================================
-- Individual translated dialogue lines with audio

create table if not exists public.dubbed_dialogue_lines (
  id uuid primary key default extensions.uuid_generate_v4(),
  dubbed_version_id uuid not null references public.dubbed_versions(id) on delete cascade,
  original_dialogue_id uuid not null references public.dialogue_lines(id) on delete cascade,
  translated_text text not null,
  audio_url text,
  timing_adjustment decimal(4,2) default 1.0 not null,
  duration_seconds decimal(10,2),
  status varchar(50) default 'pending' not null,
  generation_metadata jsonb,
  created_at timestamp with time zone default now() not null,
  check (status in ('pending', 'translated', 'generating', 'voiced', 'failed')),
  check (timing_adjustment >= 0.5 and timing_adjustment <= 2.0),
  unique(dubbed_version_id, original_dialogue_id)
);

comment on table public.dubbed_dialogue_lines is 'Translated dialogue lines for dubbed versions';
comment on column public.dubbed_dialogue_lines.translated_text is 'LLM-translated text in target language';
comment on column public.dubbed_dialogue_lines.timing_adjustment is 'Speed multiplier for timing sync (1.0 = normal)';
comment on column public.dubbed_dialogue_lines.status is 'Line status: pending, translated, generating, voiced, failed';
comment on column public.dubbed_dialogue_lines.generation_metadata is 'Voice generation metadata (provider, cost, etc.)';

-- Indexes for dubbed_dialogue_lines
create index if not exists idx_dubbed_dialogue_version on public.dubbed_dialogue_lines(dubbed_version_id);
create index if not exists idx_dubbed_dialogue_original on public.dubbed_dialogue_lines(original_dialogue_id);
create index if not exists idx_dubbed_dialogue_status on public.dubbed_dialogue_lines(status);

-- ==================================
-- Dubbed Versions RLS Policies
-- ==================================
alter table public.dubbed_versions enable row level security;
revoke all on public.dubbed_versions from authenticated, service_role;
grant select, insert, update, delete on table public.dubbed_versions to authenticated;

-- Access through episode -> project membership
create policy "dubbed_versions_read" on public.dubbed_versions for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = dubbed_versions.episode_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

create policy "dubbed_versions_create" on public.dubbed_versions for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dubbed_versions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dubbed_versions_update" on public.dubbed_versions for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dubbed_versions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dubbed_versions_delete" on public.dubbed_versions for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dubbed_versions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Dubbed Dialogue Lines RLS Policies
-- ==================================
alter table public.dubbed_dialogue_lines enable row level security;
revoke all on public.dubbed_dialogue_lines from authenticated, service_role;
grant select, insert, update, delete on table public.dubbed_dialogue_lines to authenticated;

-- Access through dubbed_version -> episode -> project membership
create policy "dubbed_dialogue_lines_read" on public.dubbed_dialogue_lines for select
  to authenticated using (
    exists (
      select 1 from public.dubbed_versions dv
      join public.episodes e on e.id = dv.episode_id
      join public.projects p on p.id = e.project_id
      where dv.id = dubbed_dialogue_lines.dubbed_version_id
      and (
        exists(
          select 1 from public.accounts a
          where a.id = p.account_id
          and a.primary_owner_user_id = auth.uid()
          and a.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

create policy "dubbed_dialogue_lines_create" on public.dubbed_dialogue_lines for insert
  to authenticated with check (
    exists (
      select 1 from public.dubbed_versions dv
      join public.episodes e on e.id = dv.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where dv.id = dubbed_dialogue_lines.dubbed_version_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dubbed_dialogue_lines_update" on public.dubbed_dialogue_lines for update
  to authenticated using (
    exists (
      select 1 from public.dubbed_versions dv
      join public.episodes e on e.id = dv.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where dv.id = dubbed_dialogue_lines.dubbed_version_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dubbed_dialogue_lines_delete" on public.dubbed_dialogue_lines for delete
  to authenticated using (
    exists (
      select 1 from public.dubbed_versions dv
      join public.episodes e on e.id = dv.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where dv.id = dubbed_dialogue_lines.dubbed_version_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );
