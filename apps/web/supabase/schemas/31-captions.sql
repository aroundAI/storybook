-- ==================================
-- Captions Schema (FILM-605)
-- ==================================
-- Auto-captions with word-level timing support for the Film Studio
-- Enables speech-to-text transcription, caption styling, and export to SRT/VTT

-- ==================================
-- Section: Captions Table
-- ==================================
-- Main caption record per episode/language combination

create table if not exists public.captions (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  language varchar(10) default 'en' not null,
  style_preset varchar(50) default 'standard' not null,
  custom_styles jsonb default '{}'::jsonb not null,
  status varchar(50) default 'pending' not null,
  source_caption_id uuid references public.captions(id) on delete set null,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (style_preset in ('standard', 'bold', 'minimal', 'animated')),
  check (status in ('pending', 'transcribing', 'translating', 'completed', 'failed')),
  unique(episode_id, language)
);

comment on table public.captions is 'Auto-generated captions for episodes with styling and multi-language support';
comment on column public.captions.language is 'ISO 639-1 language code (e.g., en, es, fr)';
comment on column public.captions.style_preset is 'Visual style: standard, bold, minimal, animated';
comment on column public.captions.custom_styles is 'Custom style overrides (font, color, position)';
comment on column public.captions.status is 'Generation status: pending, transcribing, translating, completed, failed';
comment on column public.captions.source_caption_id is 'Reference to source caption for translations';

-- Indexes for captions
create index if not exists idx_captions_episode_id on public.captions(episode_id);
create index if not exists idx_captions_episode_language on public.captions(episode_id, language);
create index if not exists idx_captions_status on public.captions(status);
create index if not exists idx_captions_source on public.captions(source_caption_id)
  where source_caption_id is not null;

-- Timestamps trigger for captions
create trigger captions_set_timestamps
before insert or update on public.captions
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Caption Segments Table
-- ==================================
-- Individual caption segments with word-level timing

create table if not exists public.caption_segments (
  id uuid primary key default extensions.uuid_generate_v4(),
  caption_id uuid not null references public.captions(id) on delete cascade,
  start_time decimal(10, 3) not null,
  end_time decimal(10, 3) not null,
  text text not null,
  words jsonb,
  speaker_id uuid references public.assets(id) on delete set null,
  sequence_number integer not null,
  is_edited boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (end_time > start_time),
  check (start_time >= 0),
  unique(caption_id, sequence_number)
);

comment on table public.caption_segments is 'Individual caption segments with timing and optional word-level data';
comment on column public.caption_segments.start_time is 'Start time in seconds (decimal for millisecond precision)';
comment on column public.caption_segments.end_time is 'End time in seconds (decimal for millisecond precision)';
comment on column public.caption_segments.text is 'Caption text for this segment';
comment on column public.caption_segments.words is 'Word-level timing array: [{word, start, end}, ...]';
comment on column public.caption_segments.speaker_id is 'Reference to character asset for speaker identification';
comment on column public.caption_segments.is_edited is 'Whether this segment was manually edited';

-- Indexes for caption_segments
create index if not exists idx_caption_segments_caption_id on public.caption_segments(caption_id);
create index if not exists idx_caption_segments_caption_sequence on public.caption_segments(caption_id, sequence_number);
create index if not exists idx_caption_segments_speaker on public.caption_segments(speaker_id)
  where speaker_id is not null;
create index if not exists idx_caption_segments_time_range on public.caption_segments(caption_id, start_time, end_time);

-- Timestamps trigger for caption_segments
create trigger caption_segments_set_timestamps
before insert or update on public.caption_segments
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: RLS Policies
-- ==================================
-- Enable RLS on caption tables

alter table public.captions enable row level security;
alter table public.caption_segments enable row level security;

-- Revoke default permissions
revoke all on public.captions from authenticated, service_role;
revoke all on public.caption_segments from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.captions to authenticated;
grant select, insert, update, delete on table public.caption_segments to authenticated;

-- ==================================
-- Captions RLS Policies
-- ==================================
-- Access control through episode -> project membership

create policy "captions_read" on public.captions for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = captions.episode_id
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

create policy "captions_create" on public.captions for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = captions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "captions_update" on public.captions for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = captions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "captions_delete" on public.captions for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = captions.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Caption Segments RLS Policies
-- ==================================
-- Access control through caption -> episode -> project membership

create policy "caption_segments_read" on public.caption_segments for select
  to authenticated using (
    exists (
      select 1 from public.captions c
      join public.episodes e on e.id = c.episode_id
      join public.projects p on p.id = e.project_id
      where c.id = caption_segments.caption_id
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

create policy "caption_segments_create" on public.caption_segments for insert
  to authenticated with check (
    exists (
      select 1 from public.captions c
      join public.episodes e on e.id = c.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = caption_segments.caption_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "caption_segments_update" on public.caption_segments for update
  to authenticated using (
    exists (
      select 1 from public.captions c
      join public.episodes e on e.id = c.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = caption_segments.caption_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "caption_segments_delete" on public.caption_segments for delete
  to authenticated using (
    exists (
      select 1 from public.captions c
      join public.episodes e on e.id = c.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = caption_segments.caption_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );
