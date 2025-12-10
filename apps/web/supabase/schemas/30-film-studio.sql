-- ==================================
-- Film Studio Database Schema
-- ==================================
-- Core tables for the AI Film Studio feature
-- Implements all FILM-101 database specs (14 tables total):
--   FILM-101a: seasons
--   FILM-101b: episodes
--   FILM-101c: shots
--   FILM-101d: assets
--   FILM-101e: dialogue_lines
--   FILM-101f: audio_tracks
--   FILM-101g: character_details
--   FILM-101h: voice_profiles
--   FILM-101i: generation_jobs
--   FILM-101j: platform_connections
--   FILM-101k: publishes
--   FILM-101l: content_analytics
--   FILM-101m: shared_resources
--   FILM-101n: external_api_keys

-- ==================================
-- Section: Seasons Table (FILM-101a)
-- ==================================
-- Organizes episodes into seasons for series-type projects
-- Optional - films and shorts don't require seasons

create table if not exists public.seasons (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number integer not null,
  name varchar(255),
  description text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone default null,
  check (number > 0)
);

-- Partial unique index to allow reusing season numbers after soft delete
create unique index if not exists seasons_project_id_number_active_idx
  on public.seasons(project_id, number)
  where deleted_at is null;

comment on table public.seasons is 'Seasons organize episodes for series-type projects';
comment on column public.seasons.number is 'Sequential season number (1, 2, 3...)';
comment on column public.seasons.name is 'Display name (e.g., "Season 1: Origins")';
comment on column public.seasons.deleted_at is 'Soft delete timestamp - NULL means active';

-- Indexes for seasons
create index if not exists idx_seasons_project_number on public.seasons(project_id, number)
  where deleted_at is null;
create index if not exists idx_seasons_project_id on public.seasons(project_id);
create index if not exists idx_seasons_deleted_at on public.seasons(deleted_at)
  where deleted_at is not null;

-- Timestamps trigger for seasons
create trigger seasons_set_timestamps
before insert or update on public.seasons
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Episodes Table (FILM-101b)
-- ==================================
-- Core content unit with workflow states and soft delete

create table if not exists public.episodes (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  season_id uuid references public.seasons(id) on delete set null,
  number integer not null,
  title varchar(255) not null,
  description text,
  status varchar(50) default 'draft' not null,
  duration_seconds integer,
  thumbnail_url text,
  final_video_url text,
  story_data jsonb,
  screenplay_data jsonb,
  shot_list jsonb,
  metadata jsonb default '{}'::jsonb not null,
  version integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone default null,
  check (status in ('draft', 'story', 'storyboard', 'generating', 'editing', 'ready', 'published')),
  check (number > 0)
);

comment on table public.episodes is 'Core content unit - episodes go through workflow states';
comment on column public.episodes.status is 'Workflow: draft -> story -> storyboard -> generating -> editing -> ready -> published';
comment on column public.episodes.version is 'Optimistic locking version number';
comment on column public.episodes.deleted_at is 'Soft delete timestamp';
comment on column public.episodes.story_data is 'Story generation output (premise, fullStory, generatedBy)';
comment on column public.episodes.screenplay_data is 'Screenplay conversion output (scenes, dialogue)';
comment on column public.episodes.shot_list is 'Shot list generation output (shots with prompts)';

-- Indexes for episodes
create index if not exists idx_episodes_project_status on public.episodes(project_id, status)
  where deleted_at is null;
create index if not exists idx_episodes_season on public.episodes(season_id)
  where deleted_at is null;
create index if not exists idx_episodes_deleted_at on public.episodes(deleted_at)
  where deleted_at is not null;
create index if not exists idx_episodes_project_id on public.episodes(project_id);

-- Timestamps trigger for episodes
create trigger episodes_set_timestamps
before insert or update on public.episodes
for each row execute function public.trigger_set_timestamps();

-- Version increment trigger for optimistic locking
create or replace function public.increment_episode_version()
returns trigger as $$
begin
  if TG_OP = 'UPDATE' and OLD.version is not null then
    NEW.version = OLD.version + 1;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger episodes_increment_version
before update on public.episodes
for each row execute function public.increment_episode_version();

-- ==================================
-- Section: Assets Table (FILM-101d)
-- ==================================
-- Polymorphic table for all project-level resources

create table if not exists public.assets (
  id uuid primary key default extensions.uuid_generate_v4(),
  project_id uuid not null references public.projects(id) on delete cascade,
  type varchar(50) not null,
  name varchar(255) not null,
  description text,
  file_url text,
  thumbnail_url text,
  metadata jsonb default '{}'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (type in ('character', 'location', 'prop', 'voice', 'music', 'sfx')),
  unique(project_id, type, name)
);

comment on table public.assets is 'Polymorphic table for project assets (characters, locations, props, voices, music, sfx)';
comment on column public.assets.type is 'Asset type: character, location, prop, voice, music, sfx';
comment on column public.assets.metadata is 'Type-specific metadata (tags, settings, etc.)';

-- Indexes for assets
create index if not exists idx_assets_project_type on public.assets(project_id, type);
create index if not exists idx_assets_type on public.assets(type);
create index if not exists idx_assets_project_id on public.assets(project_id);
create index if not exists idx_assets_metadata on public.assets using gin (metadata);

-- Timestamps trigger for assets
create trigger assets_set_timestamps
before insert or update on public.assets
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Generation Jobs Table (FILM-101i)
-- ==================================
-- Tracks all AI generation requests with retry logic and cost tracking

create table if not exists public.generation_jobs (
  id uuid primary key default extensions.uuid_generate_v4(),
  idempotency_key varchar(255) unique not null,
  account_id uuid not null references public.accounts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  job_type varchar(50) not null,
  reference_type varchar(50),
  reference_id uuid,
  provider varchar(50),
  provider_job_id varchar(255),
  status varchar(50) default 'queued' not null,
  priority integer default 0 not null,
  input_data jsonb not null,
  output_data jsonb,
  error_message text,
  error_code varchar(100),
  retry_count integer default 0 not null,
  max_retries integer default 3 not null,
  next_retry_at timestamp with time zone,
  timeout_seconds integer default 300 not null,
  cost_cents integer,
  estimated_cost_cents integer,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  check (job_type in ('video', 'voice', 'music', 'sfx', 'story', 'screenplay', 'shot_list')),
  check (status in ('queued', 'processing', 'completed', 'failed', 'cancelled', 'dead_letter')),
  check (retry_count <= max_retries)
);

comment on table public.generation_jobs is 'Tracks all AI generation requests with retry logic';
comment on column public.generation_jobs.idempotency_key is 'Unique key to prevent duplicate submissions';
comment on column public.generation_jobs.job_type is 'Type: video, voice, music, sfx, story, screenplay, shot_list';
comment on column public.generation_jobs.status is 'Status: queued, processing, completed, failed, cancelled, dead_letter';
comment on column public.generation_jobs.retry_count is 'Current retry attempt number';
comment on column public.generation_jobs.next_retry_at is 'When to retry (exponential backoff)';
comment on column public.generation_jobs.cost_cents is 'Actual cost paid in cents';
comment on column public.generation_jobs.estimated_cost_cents is 'Pre-generation cost estimate';

-- Indexes for generation_jobs
create index if not exists idx_generation_jobs_project_id on public.generation_jobs(project_id);
create index if not exists idx_generation_jobs_account_id on public.generation_jobs(account_id);
create index if not exists idx_generation_jobs_status on public.generation_jobs(status);
create index if not exists idx_generation_jobs_provider_job_id on public.generation_jobs(provider_job_id)
  where provider_job_id is not null;
create index if not exists idx_generation_jobs_next_retry on public.generation_jobs(next_retry_at)
  where next_retry_at is not null and status = 'failed';
create index if not exists idx_generation_jobs_reference on public.generation_jobs(reference_type, reference_id)
  where reference_type is not null;
create index if not exists idx_generation_jobs_job_type_status on public.generation_jobs(job_type, status);

-- ==================================
-- Section: Platform Connections Table (FILM-101j)
-- ==================================
-- OAuth tokens for publishing platforms (YouTube, TikTok, etc.)

create table if not exists public.platform_connections (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  platform varchar(50) not null,
  platform_account_id varchar(255),
  platform_account_name varchar(255),
  access_token_encrypted text,
  refresh_token_encrypted text,
  token_expires_at timestamp with time zone,
  scopes text[],
  is_active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  check (platform in ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin')),
  unique(account_id, platform, platform_account_id)
);

comment on table public.platform_connections is 'OAuth tokens for publishing to social platforms';
comment on column public.platform_connections.platform is 'Platform: youtube, tiktok, instagram, facebook, twitter, linkedin';
comment on column public.platform_connections.access_token_encrypted is 'Encrypted OAuth access token';
comment on column public.platform_connections.refresh_token_encrypted is 'Encrypted OAuth refresh token';
comment on column public.platform_connections.is_active is 'Whether the connection is active for use';

-- Indexes for platform_connections
create index if not exists idx_platform_connections_account_id on public.platform_connections(account_id);
create index if not exists idx_platform_connections_platform on public.platform_connections(account_id, platform);
create index if not exists idx_platform_connections_active on public.platform_connections(account_id, is_active)
  where is_active = true;
create index if not exists idx_platform_connections_expires_at on public.platform_connections(token_expires_at)
  where token_expires_at is not null and is_active = true;

-- Timestamps trigger for platform_connections
create trigger platform_connections_set_timestamps
before insert or update on public.platform_connections
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Shared Resources Table (FILM-101m)
-- ==================================
-- Organization-level reusable resources (SFX, music, transitions)

create table if not exists public.shared_resources (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  type varchar(50) not null,
  name varchar(255) not null,
  description text,
  file_url text,
  tags text[],
  is_system boolean default false not null,
  created_at timestamp with time zone default now() not null,
  check (type in ('sfx', 'music_template', 'transition', 'overlay', 'preset'))
);

comment on table public.shared_resources is 'Organization-level reusable resources (SFX, music, etc.)';
comment on column public.shared_resources.type is 'Type: sfx, music_template, transition, overlay, preset';
comment on column public.shared_resources.is_system is 'System-provided resource (available to all accounts)';
comment on column public.shared_resources.tags is 'Searchable tags for filtering';

-- Indexes for shared_resources
create index if not exists idx_shared_resources_account_id on public.shared_resources(account_id);
create index if not exists idx_shared_resources_type on public.shared_resources(account_id, type);
create index if not exists idx_shared_resources_tags on public.shared_resources using gin (tags);
create index if not exists idx_shared_resources_system on public.shared_resources(is_system, type)
  where is_system = true;

-- ==================================
-- Section: External API Keys Table (FILM-101n)
-- ==================================
-- BYOK (Bring Your Own Key) for external AI services

create table if not exists public.external_api_keys (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  provider varchar(50) not null,
  encrypted_key text not null,
  is_active boolean default true not null,
  last_used_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  check (provider in ('kling', 'runway', 'hailuo', 'elevenlabs', 'playht', 'suno', 'udio', 'claude', 'openai', 'gemini')),
  unique(account_id, provider)
);

comment on table public.external_api_keys is 'BYOK (Bring Your Own Key) for external AI services';
comment on column public.external_api_keys.provider is 'Provider: kling, runway, hailuo, elevenlabs, playht, suno, udio, claude, openai, gemini';
comment on column public.external_api_keys.encrypted_key is 'Encrypted API key (never stored in plaintext)';
comment on column public.external_api_keys.is_active is 'Whether the key is active for use';
comment on column public.external_api_keys.last_used_at is 'Last time the key was used for generation';

-- Indexes for external_api_keys
create index if not exists idx_external_api_keys_account_id on public.external_api_keys(account_id);
create index if not exists idx_external_api_keys_provider on public.external_api_keys(account_id, provider);
create index if not exists idx_external_api_keys_active on public.external_api_keys(account_id, is_active)
  where is_active = true;

-- ==================================
-- Section: Shots Table (FILM-101c)
-- ==================================
-- Individual video clips that make up an episode

create table if not exists public.shots (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  scene_number integer,
  shot_number integer,
  sequence_number integer not null,
  duration_seconds integer default 10 not null,
  scene_description text,
  action_description text,
  prompt text not null,
  camera_direction varchar(100),
  status varchar(50) default 'pending' not null,
  video_url text,
  thumbnail_url text,
  generation_job_id uuid,
  generation_metadata jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone default null,
  check (status in ('pending', 'queued', 'generating', 'completed', 'failed', 'approved')),
  check (duration_seconds > 0 and duration_seconds <= 60),
  unique(episode_id, sequence_number)
);

comment on table public.shots is 'Individual video clips that make up an episode';
comment on column public.shots.scene_number is 'Scene number this shot belongs to';
comment on column public.shots.shot_number is 'Shot number within the scene';
comment on column public.shots.sequence_number is 'Order within episode (1, 2, 3...)';
comment on column public.shots.prompt is 'Kling/Runway-ready prompt';
comment on column public.shots.status is 'Generation status: pending, queued, generating, completed, failed, approved';
comment on column public.shots.generation_metadata is 'Provider-specific metadata (provider, cost, parameters)';
comment on column public.shots.deleted_at is 'Soft delete timestamp';

-- Indexes for shots
create index if not exists idx_shots_episode_sequence on public.shots(episode_id, sequence_number)
  where deleted_at is null;
create index if not exists idx_shots_status on public.shots(status);
create index if not exists idx_shots_generation_job_id on public.shots(generation_job_id)
  where generation_job_id is not null;
create index if not exists idx_shots_episode_id on public.shots(episode_id);
create index if not exists idx_shots_deleted_at on public.shots(deleted_at)
  where deleted_at is not null;

-- Timestamps trigger for shots
create trigger shots_set_timestamps
before insert or update on public.shots
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Dialogue Lines Table (FILM-101e)
-- ==================================
-- Individual dialogue lines for voice generation

create table if not exists public.dialogue_lines (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  shot_id uuid references public.shots(id) on delete set null,
  character_asset_id uuid references public.assets(id) on delete set null,
  text text not null,
  sequence_number integer not null,
  audio_url text,
  status varchar(50) default 'pending' not null,
  generation_metadata jsonb,
  created_at timestamp with time zone default now() not null,
  check (status in ('pending', 'generating', 'completed', 'failed')),
  unique(episode_id, sequence_number)
);

comment on table public.dialogue_lines is 'Individual dialogue lines for voice generation';
comment on column public.dialogue_lines.shot_id is 'Optional FK to shot for shot-specific dialogue';
comment on column public.dialogue_lines.character_asset_id is 'FK to character speaking this line';
comment on column public.dialogue_lines.status is 'Generation status: pending, generating, completed, failed';

-- Indexes for dialogue_lines
create index if not exists idx_dialogue_lines_episode_sequence on public.dialogue_lines(episode_id, sequence_number);
create index if not exists idx_dialogue_lines_shot on public.dialogue_lines(shot_id)
  where shot_id is not null;
create index if not exists idx_dialogue_lines_character on public.dialogue_lines(character_asset_id)
  where character_asset_id is not null;
create index if not exists idx_dialogue_lines_status on public.dialogue_lines(status);

-- ==================================
-- Section: Audio Tracks Table (FILM-101f)
-- ==================================
-- Music, SFX, and composite dialogue tracks for episodes

create table if not exists public.audio_tracks (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  type varchar(50) not null,
  name varchar(255),
  file_url text,
  duration_seconds decimal(10, 2),
  timeline_start_seconds decimal(10, 2) default 0 not null,
  volume decimal(3, 2) default 1.0 not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  check (type in ('music', 'sfx', 'dialogue_composite', 'ambient')),
  check (volume >= 0.0 and volume <= 2.0),
  check (timeline_start_seconds >= 0)
);

comment on table public.audio_tracks is 'Music, SFX, and composite dialogue tracks for episodes';
comment on column public.audio_tracks.type is 'Track type: music, sfx, dialogue_composite, ambient';
comment on column public.audio_tracks.timeline_start_seconds is 'Start position in timeline';
comment on column public.audio_tracks.volume is 'Volume level (0.0-2.0)';

-- Indexes for audio_tracks
create index if not exists idx_audio_tracks_episode on public.audio_tracks(episode_id);
create index if not exists idx_audio_tracks_type on public.audio_tracks(episode_id, type);

-- ==================================
-- Section: Character Details Table (FILM-101g)
-- ==================================
-- Extends assets table for character-type assets

create table if not exists public.character_details (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  physical_attributes jsonb,
  personality text,
  element_prompt text,
  reference_images text[],
  voice_asset_id uuid references public.assets(id) on delete set null
);

comment on table public.character_details is 'Extension table for character-type assets';
comment on column public.character_details.physical_attributes is 'Structured character appearance (age, height, hair, eyes, etc.)';
comment on column public.character_details.element_prompt is 'Kling-ready prompt for character consistency';
comment on column public.character_details.reference_images is 'Array of reference image URLs';
comment on column public.character_details.voice_asset_id is 'FK to voice asset for this character';

-- Indexes for character_details
create index if not exists idx_character_details_voice_asset_id on public.character_details(voice_asset_id)
  where voice_asset_id is not null;
create index if not exists idx_character_details_physical_attributes
  on public.character_details using gin (physical_attributes);

-- ==================================
-- Section: Voice Profiles Table (FILM-101h)
-- ==================================
-- Extends assets table for voice-type assets

create table if not exists public.voice_profiles (
  asset_id uuid primary key references public.assets(id) on delete cascade,
  provider varchar(50) not null,
  provider_voice_id varchar(255),
  settings jsonb default '{}'::jsonb not null,
  check (provider in ('elevenlabs', 'playht', 'azure', 'google', 'custom'))
);

comment on table public.voice_profiles is 'Extension table for voice-type assets';
comment on column public.voice_profiles.provider is 'Voice provider: elevenlabs, playht, azure, google, custom';
comment on column public.voice_profiles.provider_voice_id is 'Provider voice ID (if using pre-made voice)';
comment on column public.voice_profiles.settings is 'Provider-specific generation settings';

-- Indexes for voice_profiles
create index if not exists idx_voice_profiles_provider on public.voice_profiles(provider);
create index if not exists idx_voice_profiles_settings on public.voice_profiles using gin (settings);

-- ==================================
-- Section: Publishes Table (FILM-101k)
-- ==================================
-- Tracks published content across platforms

create table if not exists public.publishes (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,
  platform_connection_id uuid not null references public.platform_connections(id) on delete cascade,
  platform varchar(50) not null,
  content_type varchar(50) default 'full' not null,
  platform_content_id varchar(255),
  platform_url text,
  title varchar(500),
  description text,
  tags text[],
  thumbnail_url text,
  status varchar(50) default 'draft' not null,
  scheduled_at timestamp with time zone,
  published_at timestamp with time zone,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  check (platform in ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin')),
  check (content_type in ('full', 'short', 'teaser', 'trailer')),
  check (status in ('draft', 'scheduled', 'publishing', 'published', 'failed', 'unlisted', 'deleted'))
);

comment on table public.publishes is 'Tracks published content across platforms';
comment on column public.publishes.platform is 'Platform: youtube, tiktok, instagram, facebook, twitter, linkedin';
comment on column public.publishes.content_type is 'Content variant: full, short, teaser, trailer';
comment on column public.publishes.status is 'Publish status: draft, scheduled, publishing, published, failed, unlisted, deleted';
comment on column public.publishes.platform_content_id is 'Platform video/post ID';

-- Indexes for publishes
create index if not exists idx_publishes_episode_id on public.publishes(episode_id);
create index if not exists idx_publishes_platform_connection_id on public.publishes(platform_connection_id);
create index if not exists idx_publishes_platform_status on public.publishes(platform, status);
create index if not exists idx_publishes_scheduled_at on public.publishes(scheduled_at)
  where scheduled_at is not null and status = 'scheduled';
create index if not exists idx_publishes_platform_content_id on public.publishes(platform, platform_content_id)
  where platform_content_id is not null;

-- ==================================
-- Section: Content Analytics Table (FILM-101l)
-- ==================================
-- Daily snapshots of content performance across platforms

create table if not exists public.content_analytics (
  id uuid primary key default extensions.uuid_generate_v4(),
  publish_id uuid not null references public.publishes(id) on delete cascade,
  snapshot_date date not null,
  views bigint default 0 not null,
  likes bigint default 0 not null,
  comments bigint default 0 not null,
  shares bigint default 0 not null,
  watch_time_seconds bigint default 0 not null,
  subscribers_gained integer default 0 not null,
  revenue_cents integer default 0 not null,
  retention_data jsonb,
  raw_data jsonb,
  created_at timestamp with time zone default now() not null,
  unique(publish_id, snapshot_date)
);

comment on table public.content_analytics is 'Daily snapshots of content performance metrics';
comment on column public.content_analytics.snapshot_date is 'Date of this snapshot';
comment on column public.content_analytics.watch_time_seconds is 'Total watch time in seconds';
comment on column public.content_analytics.revenue_cents is 'Revenue generated in cents';
comment on column public.content_analytics.retention_data is 'Audience retention curve data';
comment on column public.content_analytics.raw_data is 'Platform-specific raw metrics';

-- Indexes for content_analytics
create index if not exists idx_content_analytics_publish_id on public.content_analytics(publish_id);
create index if not exists idx_content_analytics_snapshot_date on public.content_analytics(snapshot_date desc);
create index if not exists idx_content_analytics_publish_date on public.content_analytics(publish_id, snapshot_date desc);
create index if not exists idx_content_analytics_views on public.content_analytics(views desc);

-- ==================================
-- Section: RLS Policies
-- ==================================
-- Enable RLS on all tables

alter table public.seasons enable row level security;
alter table public.episodes enable row level security;
alter table public.assets enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.platform_connections enable row level security;
alter table public.shared_resources enable row level security;
alter table public.external_api_keys enable row level security;
alter table public.shots enable row level security;
alter table public.dialogue_lines enable row level security;
alter table public.audio_tracks enable row level security;
alter table public.character_details enable row level security;
alter table public.voice_profiles enable row level security;
alter table public.publishes enable row level security;
alter table public.content_analytics enable row level security;

-- Revoke default permissions
revoke all on public.seasons from authenticated, service_role;
revoke all on public.episodes from authenticated, service_role;
revoke all on public.assets from authenticated, service_role;
revoke all on public.generation_jobs from authenticated, service_role;
revoke all on public.platform_connections from authenticated, service_role;
revoke all on public.shared_resources from authenticated, service_role;
revoke all on public.external_api_keys from authenticated, service_role;
revoke all on public.shots from authenticated, service_role;
revoke all on public.dialogue_lines from authenticated, service_role;
revoke all on public.audio_tracks from authenticated, service_role;
revoke all on public.character_details from authenticated, service_role;
revoke all on public.voice_profiles from authenticated, service_role;
revoke all on public.publishes from authenticated, service_role;
revoke all on public.content_analytics from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.seasons to authenticated;
grant select, insert, update, delete on table public.episodes to authenticated;
grant select, insert, update, delete on table public.assets to authenticated;
grant select, insert, update, delete on table public.generation_jobs to authenticated;
grant select, insert, update, delete on table public.platform_connections to authenticated;
grant select, insert, update, delete on table public.shared_resources to authenticated;
grant select, insert, update, delete on table public.external_api_keys to authenticated;
grant select, insert, update, delete on table public.shots to authenticated;
grant select, insert, update, delete on table public.dialogue_lines to authenticated;
grant select, insert, update, delete on table public.audio_tracks to authenticated;
grant select, insert, update, delete on table public.character_details to authenticated;
grant select, insert, update, delete on table public.voice_profiles to authenticated;
grant select, insert, update, delete on table public.publishes to authenticated;
grant select, insert, update, delete on table public.content_analytics to authenticated;

-- ==================================
-- Seasons RLS Policies
-- ==================================
-- Access control through project membership

create policy "seasons_read" on public.seasons for select
  to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = seasons.project_id
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

create policy "seasons_create" on public.seasons for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = seasons.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "seasons_update" on public.seasons for update
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = seasons.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

create policy "seasons_delete" on public.seasons for delete
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = seasons.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Episodes RLS Policies
-- ==================================

create policy "episodes_read" on public.episodes for select
  to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = episodes.project_id
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

create policy "episodes_create" on public.episodes for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = episodes.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "episodes_update" on public.episodes for update
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = episodes.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "episodes_delete" on public.episodes for delete
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = episodes.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Assets RLS Policies
-- ==================================

create policy "assets_read" on public.assets for select
  to authenticated using (
    exists (
      select 1 from public.projects p
      where p.id = assets.project_id
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

create policy "assets_create" on public.assets for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = assets.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "assets_update" on public.assets for update
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = assets.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "assets_delete" on public.assets for delete
  to authenticated using (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = assets.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Generation Jobs RLS Policies
-- ==================================

create policy "generation_jobs_read" on public.generation_jobs for select
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "generation_jobs_create" on public.generation_jobs for insert
  to authenticated with check (
    exists (
      select 1 from public.project_members pm
      where pm.project_id = generation_jobs.project_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "generation_jobs_update" on public.generation_jobs for update
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- No delete policy for generation_jobs - jobs should not be deleted

-- ==================================
-- Platform Connections RLS Policies
-- ==================================

create policy "platform_connections_read" on public.platform_connections for select
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "platform_connections_create" on public.platform_connections for insert
  to authenticated with check (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "platform_connections_update" on public.platform_connections for update
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "platform_connections_delete" on public.platform_connections for delete
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- ==================================
-- Shared Resources RLS Policies
-- ==================================

create policy "shared_resources_read" on public.shared_resources for select
  to authenticated using (
    -- User can access their account's resources
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
    -- Or system resources (is_system = true)
    or is_system = true
  );

create policy "shared_resources_create" on public.shared_resources for insert
  to authenticated with check (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
    and is_system = false
  );

create policy "shared_resources_update" on public.shared_resources for update
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
    and is_system = false
  );

create policy "shared_resources_delete" on public.shared_resources for delete
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
    and is_system = false
  );

-- ==================================
-- External API Keys RLS Policies
-- ==================================

create policy "external_api_keys_read" on public.external_api_keys for select
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "external_api_keys_create" on public.external_api_keys for insert
  to authenticated with check (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "external_api_keys_update" on public.external_api_keys for update
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

create policy "external_api_keys_delete" on public.external_api_keys for delete
  to authenticated using (
    account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- ==================================
-- Shots RLS Policies
-- ==================================
-- Access control through episode -> project membership

create policy "shots_read" on public.shots for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = shots.episode_id
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

create policy "shots_create" on public.shots for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = shots.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "shots_update" on public.shots for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = shots.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "shots_delete" on public.shots for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = shots.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Dialogue Lines RLS Policies
-- ==================================
-- Access control through episode -> project membership

create policy "dialogue_lines_read" on public.dialogue_lines for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = dialogue_lines.episode_id
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

create policy "dialogue_lines_create" on public.dialogue_lines for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dialogue_lines.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dialogue_lines_update" on public.dialogue_lines for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dialogue_lines.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "dialogue_lines_delete" on public.dialogue_lines for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = dialogue_lines.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Audio Tracks RLS Policies
-- ==================================
-- Access control through episode -> project membership

create policy "audio_tracks_read" on public.audio_tracks for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = audio_tracks.episode_id
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

create policy "audio_tracks_create" on public.audio_tracks for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = audio_tracks.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "audio_tracks_update" on public.audio_tracks for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = audio_tracks.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "audio_tracks_delete" on public.audio_tracks for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = audio_tracks.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Character Details RLS Policies
-- ==================================
-- Access control through asset -> project membership

create policy "character_details_read" on public.character_details for select
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = character_details.asset_id
      and (
        exists(
          select 1 from public.accounts acc
          where acc.id = p.account_id
          and acc.primary_owner_user_id = auth.uid()
          and acc.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

create policy "character_details_create" on public.character_details for insert
  to authenticated with check (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = character_details.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "character_details_update" on public.character_details for update
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = character_details.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "character_details_delete" on public.character_details for delete
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = character_details.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Voice Profiles RLS Policies
-- ==================================
-- Access control through asset -> project membership

create policy "voice_profiles_read" on public.voice_profiles for select
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.projects p on p.id = a.project_id
      where a.id = voice_profiles.asset_id
      and (
        exists(
          select 1 from public.accounts acc
          where acc.id = p.account_id
          and acc.primary_owner_user_id = auth.uid()
          and acc.is_personal_account = true
        )
        or
        public.has_role_on_account(p.account_id)
      )
    )
  );

create policy "voice_profiles_create" on public.voice_profiles for insert
  to authenticated with check (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = voice_profiles.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "voice_profiles_update" on public.voice_profiles for update
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = voice_profiles.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "voice_profiles_delete" on public.voice_profiles for delete
  to authenticated using (
    exists (
      select 1 from public.assets a
      join public.project_members pm on pm.project_id = a.project_id
      where a.id = voice_profiles.asset_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Publishes RLS Policies
-- ==================================
-- Access control through episode -> project membership

create policy "publishes_read" on public.publishes for select
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.projects p on p.id = e.project_id
      where e.id = publishes.episode_id
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

create policy "publishes_create" on public.publishes for insert
  to authenticated with check (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = publishes.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "publishes_update" on public.publishes for update
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = publishes.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "publishes_delete" on public.publishes for delete
  to authenticated using (
    exists (
      select 1 from public.episodes e
      join public.project_members pm on pm.project_id = e.project_id
      where e.id = publishes.episode_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin')
    )
  );

-- ==================================
-- Content Analytics RLS Policies
-- ==================================
-- Access control through publish -> episode -> project membership

create policy "content_analytics_read" on public.content_analytics for select
  to authenticated using (
    exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.projects p on p.id = e.project_id
      where pub.id = content_analytics.publish_id
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

create policy "content_analytics_create" on public.content_analytics for insert
  to authenticated with check (
    exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = content_analytics.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

create policy "content_analytics_update" on public.content_analytics for update
  to authenticated using (
    exists (
      select 1 from public.publishes pub
      join public.episodes e on e.id = pub.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where pub.id = content_analytics.publish_id
      and pm.user_id = auth.uid()
      and pm.role in ('owner', 'admin', 'member')
    )
  );

-- No delete policy for content_analytics - historical data should not be deleted
