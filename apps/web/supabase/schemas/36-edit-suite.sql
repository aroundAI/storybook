-- ==================================
-- Edit Suite v2 Database Schema — RETIRED (FILM-607, 2026-09-23)
-- ==================================
-- The Edit Suite was retired and its code removed. These tables keep their
-- rows, read-only, until the owner decides (FILM-608 drops them): the read
-- policies below remain, every write policy and write grant is gone
-- (migration 20260923082656_film607-retire-edit-suite.sql), and the Edit
-- Suite's functions are dropped.
-- Phase 14: In-browser NLE for per-episode video editing
-- Tables:
--   edit_projects       — One per episode, stores canvas/render config
--   edit_tracks          — Layers (video, dialogue, music, sfx, etc.)
--   edit_clips           — Timeline items with polymorphic source
--   edit_transitions     — Between adjacent clips
--   edit_keyframes       — Per-clip property animation
--   dialogue_sync_groups — Multilingual dialogue linking

-- ==================================
-- Section: Edit Projects
-- ==================================
-- One edit project per episode. Stores canvas dimensions, fps,
-- active language, and render status.

create table if not exists public.edit_projects (
  id uuid primary key default extensions.uuid_generate_v4(),
  episode_id uuid not null references public.episodes(id) on delete cascade,

  -- Canvas
  width integer not null default 1920,
  height integer not null default 1080,
  fps integer not null default 30,
  active_language varchar(10) not null default 'en',

  -- Render state
  render_status varchar(50) not null default 'none'
    check (render_status in ('none', 'queued', 'rendering', 'completed', 'failed')),
  render_url text,
  render_error text,
  render_started_at timestamp with time zone,
  render_completed_at timestamp with time zone,

  -- Versioning
  version integer not null default 1,

  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,

  -- One edit project per episode
  unique(episode_id)
);

comment on table public.edit_projects is 'Edit Suite project — one per episode, stores NLE state';
comment on column public.edit_projects.active_language is 'Currently active dialogue language for preview';
comment on column public.edit_projects.render_status is 'Export render status: none, queued, rendering, completed, failed';
comment on column public.edit_projects.version is 'Optimistic concurrency version counter';

-- Indexes
create index if not exists idx_edit_projects_episode on public.edit_projects(episode_id);

-- Timestamps trigger
create trigger edit_projects_set_timestamps
before insert or update on public.edit_projects
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Edit Tracks
-- ==================================
-- Layers within an edit project. Each track has a type, name,
-- volume, and mute/solo/lock state.

create table if not exists public.edit_tracks (
  id uuid primary key default extensions.uuid_generate_v4(),
  edit_project_id uuid not null references public.edit_projects(id) on delete cascade,

  type varchar(50) not null
    check (type in ('video', 'dialogue', 'music', 'sfx', 'ambient', 'title', 'upload')),
  name varchar(255) not null,
  sort_order integer not null default 0,

  -- Audio
  volume decimal(3,2) not null default 1.0
    check (volume >= 0 and volume <= 2.0),
  is_muted boolean not null default false,
  is_solo boolean not null default false,
  is_locked boolean not null default false,

  -- Display
  height integer not null default 64,

  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.edit_tracks is 'Timeline track/layer within an edit project';
comment on column public.edit_tracks.type is 'Track type: video, dialogue, music, sfx, ambient, title, upload';
comment on column public.edit_tracks.sort_order is 'Vertical ordering in timeline (0 = top)';

-- Indexes
create index if not exists idx_edit_tracks_project on public.edit_tracks(edit_project_id);
create index if not exists idx_edit_tracks_project_sort on public.edit_tracks(edit_project_id, sort_order);

-- Timestamps trigger
create trigger edit_tracks_set_timestamps
before insert or update on public.edit_tracks
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- Section: Dialogue Sync Groups
-- ==================================
-- Links all language variants of a dialogue line so they
-- move together when edited. Must be created before edit_clips
-- so that clips can reference sync groups.

create table if not exists public.dialogue_sync_groups (
  id uuid primary key default extensions.uuid_generate_v4(),
  edit_project_id uuid not null references public.edit_projects(id) on delete cascade,

  -- The original English dialogue line this group is anchored to
  anchor_dialogue_id uuid not null references public.dialogue_lines(id) on delete cascade,

  -- The primary clip (usually English) that drives position for the group
  primary_clip_id uuid,

  created_at timestamp with time zone default now() not null,

  -- One sync group per dialogue line per project
  unique(edit_project_id, anchor_dialogue_id)
);

comment on table public.dialogue_sync_groups is 'Links all language variants of a dialogue line for synchronized editing';
comment on column public.dialogue_sync_groups.primary_clip_id is 'The clip whose position drives all other variants in the group';

-- Indexes
create index if not exists idx_dialogue_sync_groups_project on public.dialogue_sync_groups(edit_project_id);
create index if not exists idx_dialogue_sync_groups_anchor on public.dialogue_sync_groups(anchor_dialogue_id);

-- ==================================
-- Section: Edit Clips
-- ==================================
-- Individual clips placed on the timeline. Each clip has a
-- polymorphic source (shot, dialogue, dubbed dialogue, audio track,
-- or uploaded media).

create table if not exists public.edit_clips (
  id uuid primary key default extensions.uuid_generate_v4(),
  track_id uuid not null references public.edit_tracks(id) on delete cascade,

  -- Source (polymorphic — at most one non-null for linked sources)
  source_shot_id uuid references public.shots(id) on delete set null,
  source_dialogue_id uuid references public.dialogue_lines(id) on delete set null,
  source_dubbed_dialogue_id uuid references public.dubbed_dialogue_lines(id) on delete set null,
  source_audio_track_id uuid references public.audio_tracks(id) on delete set null,
  source_upload_url text,

  -- Resolved media URL (denormalized for fast access)
  media_url text,
  thumbnail_url text,

  -- Timeline position (milliseconds)
  start_ms integer not null default 0
    check (start_ms >= 0),
  end_ms integer not null
    check (end_ms > start_ms),

  -- Source trim points (milliseconds relative to source start)
  in_point_ms integer not null default 0,
  out_point_ms integer not null,

  -- Adjustments
  volume decimal(3,2) not null default 1.0
    check (volume >= 0 and volume <= 2.0),
  speed decimal(3,2) not null default 1.0
    check (speed >= 0.25 and speed <= 4.0),
  fade_in_ms integer not null default 0,
  fade_out_ms integer not null default 0,

  sort_order integer not null default 0,

  -- Multilingual sync
  sync_group_id uuid references public.dialogue_sync_groups(id) on delete set null,
  language varchar(10),
  is_active boolean not null default true,

  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

comment on table public.edit_clips is 'Timeline clip item with polymorphic source';
comment on column public.edit_clips.start_ms is 'Timeline position start in milliseconds';
comment on column public.edit_clips.end_ms is 'Timeline position end in milliseconds';
comment on column public.edit_clips.in_point_ms is 'Source media trim start (relative to source)';
comment on column public.edit_clips.out_point_ms is 'Source media trim end (relative to source)';
comment on column public.edit_clips.sync_group_id is 'Links to dialogue sync group for multilingual editing';
comment on column public.edit_clips.is_active is 'Whether this clip is active in current language preview';

-- Indexes
create index if not exists idx_edit_clips_track on public.edit_clips(track_id);
create index if not exists idx_edit_clips_sync_group on public.edit_clips(sync_group_id);
create index if not exists idx_edit_clips_source_shot on public.edit_clips(source_shot_id) where source_shot_id is not null;
create index if not exists idx_edit_clips_source_dialogue on public.edit_clips(source_dialogue_id) where source_dialogue_id is not null;
create index if not exists idx_edit_clips_track_position on public.edit_clips(track_id, start_ms);

-- Timestamps trigger
create trigger edit_clips_set_timestamps
before insert or update on public.edit_clips
for each row execute function public.trigger_set_timestamps();

-- Add FK from dialogue_sync_groups.primary_clip_id → edit_clips.id
-- (deferred because edit_clips didn't exist when dialogue_sync_groups was created)
alter table public.dialogue_sync_groups
  add constraint fk_dialogue_sync_groups_primary_clip
  foreign key (primary_clip_id) references public.edit_clips(id) on delete set null;

-- ==================================
-- Section: Edit Transitions
-- ==================================
-- Transition effects between adjacent clips on the same track.

create table if not exists public.edit_transitions (
  id uuid primary key default extensions.uuid_generate_v4(),
  from_clip_id uuid not null references public.edit_clips(id) on delete cascade,
  to_clip_id uuid not null references public.edit_clips(id) on delete cascade,

  type varchar(50) not null default 'cut'
    check (type in ('cut', 'crossfade', 'fade_black', 'fade_white',
                     'wipe_left', 'wipe_right', 'dissolve')),
  duration_ms integer not null default 500
    check (duration_ms >= 0 and duration_ms <= 5000),

  -- Extra params for specific transition types (e.g., direction, color)
  params jsonb not null default '{}'::jsonb,

  created_at timestamp with time zone default now() not null
);

comment on table public.edit_transitions is 'Transition effect between two adjacent clips';
comment on column public.edit_transitions.duration_ms is 'Transition duration in milliseconds (0-5000)';
comment on column public.edit_transitions.params is 'Additional parameters for specific transition types';

-- Indexes
create index if not exists idx_edit_transitions_from on public.edit_transitions(from_clip_id);
create index if not exists idx_edit_transitions_to on public.edit_transitions(to_clip_id);

-- ==================================
-- Section: Edit Keyframes
-- ==================================
-- Per-clip property animation. Each keyframe defines a value at
-- a specific offset within the clip, with easing to the next keyframe.

create table if not exists public.edit_keyframes (
  id uuid primary key default extensions.uuid_generate_v4(),
  clip_id uuid not null references public.edit_clips(id) on delete cascade,

  -- Animated property
  property varchar(50) not null
    check (property in ('volume', 'position_x', 'position_y', 'scale', 'rotation', 'opacity')),

  -- Position relative to clip start (not timeline start)
  offset_ms integer not null
    check (offset_ms >= 0),

  -- Value at this keyframe
  value decimal(10,4) not null,

  -- Interpolation to NEXT keyframe
  easing varchar(30) not null default 'linear'
    check (easing in ('linear', 'ease_in', 'ease_out', 'ease_in_out', 'hold', 'bezier')),

  -- Bezier control points (only used when easing = 'bezier')
  bezier_cp1_x decimal(4,3),
  bezier_cp1_y decimal(4,3),
  bezier_cp2_x decimal(4,3),
  bezier_cp2_y decimal(4,3),

  created_at timestamp with time zone default now() not null
);

comment on table public.edit_keyframes is 'Keyframe animation for clip properties (volume, position, scale, etc.)';
comment on column public.edit_keyframes.property is 'Which property is animated: volume, position_x/y, scale, rotation, opacity';
comment on column public.edit_keyframes.offset_ms is 'Time offset from clip start in milliseconds';
comment on column public.edit_keyframes.easing is 'Interpolation to next keyframe: linear, ease_in/out, hold, bezier';

-- Indexes
create index if not exists idx_edit_keyframes_clip on public.edit_keyframes(clip_id);
create index if not exists idx_edit_keyframes_clip_property on public.edit_keyframes(clip_id, property, offset_ms);

-- ==================================
-- Section: RLS Policies — edit_projects
-- ==================================

alter table public.edit_projects enable row level security;

create policy "edit_projects_read" on public.edit_projects for select
  to authenticated using (
    exists (
      select 1 from public.projects p
      join public.episodes e on e.project_id = p.id
      where e.id = edit_projects.episode_id
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

-- ==================================
-- Section: RLS Policies — edit_tracks
-- ==================================
-- Access derived through edit_project_id → episodes → projects

alter table public.edit_tracks enable row level security;

create policy "edit_tracks_read" on public.edit_tracks for select
  to authenticated using (
    exists (
      select 1 from public.edit_projects ep
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where ep.id = edit_tracks.edit_project_id
      and pm.user_id = auth.uid()
    )
  );

-- ==================================
-- Section: RLS Policies — dialogue_sync_groups
-- ==================================

alter table public.dialogue_sync_groups enable row level security;

create policy "dialogue_sync_groups_read" on public.dialogue_sync_groups for select
  to authenticated using (
    exists (
      select 1 from public.edit_projects ep
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where ep.id = dialogue_sync_groups.edit_project_id
      and pm.user_id = auth.uid()
    )
  );

-- ==================================
-- Section: RLS Policies — edit_clips
-- ==================================
-- Access derived through track_id → edit_project_id → episodes → projects

alter table public.edit_clips enable row level security;

create policy "edit_clips_read" on public.edit_clips for select
  to authenticated using (
    exists (
      select 1 from public.edit_tracks t
      join public.edit_projects ep on ep.id = t.edit_project_id
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where t.id = edit_clips.track_id
      and pm.user_id = auth.uid()
    )
  );

-- ==================================
-- Section: RLS Policies — edit_transitions
-- ==================================
-- Access derived through from_clip_id → track_id → ... → project_members

alter table public.edit_transitions enable row level security;

create policy "edit_transitions_read" on public.edit_transitions for select
  to authenticated using (
    exists (
      select 1 from public.edit_clips c
      join public.edit_tracks t on t.id = c.track_id
      join public.edit_projects ep on ep.id = t.edit_project_id
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = edit_transitions.from_clip_id
      and pm.user_id = auth.uid()
    )
  );

-- ==================================
-- Section: RLS Policies — edit_keyframes
-- ==================================
-- Access derived through clip_id → track_id → ... → project_members

alter table public.edit_keyframes enable row level security;

create policy "edit_keyframes_read" on public.edit_keyframes for select
  to authenticated using (
    exists (
      select 1 from public.edit_clips c
      join public.edit_tracks t on t.id = c.track_id
      join public.edit_projects ep on ep.id = t.edit_project_id
      join public.episodes e on e.id = ep.episode_id
      join public.project_members pm on pm.project_id = e.project_id
      where c.id = edit_keyframes.clip_id
      and pm.user_id = auth.uid()
    )
  );

-- ==================================
-- Section: Retired — read-only (FILM-607)
-- ==================================

revoke insert, update, delete, truncate, references, trigger
  on public.edit_projects, public.edit_tracks, public.edit_clips,
     public.edit_keyframes, public.edit_transitions, public.dialogue_sync_groups
  from public, anon, authenticated;

revoke select
  on public.edit_projects, public.edit_tracks, public.edit_clips,
     public.edit_keyframes, public.edit_transitions, public.dialogue_sync_groups
  from public, anon;
