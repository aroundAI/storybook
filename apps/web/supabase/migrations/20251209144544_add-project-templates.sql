-- ==================================
-- Project Templates Table (FILM-111)
-- ==================================
-- Stores system and custom project templates for Film Studio
-- System templates (is_system=true) are available to all users
-- Custom templates (is_system=false) belong to specific accounts

create table if not exists public.project_templates (
  id uuid primary key default extensions.uuid_generate_v4(),
  account_id uuid references public.accounts(id) on delete cascade,
  name varchar(255) not null,
  description text,
  thumbnail_url text,
  category varchar(50) not null,
  genre varchar(50),
  target_duration_minutes integer,
  is_system boolean default false not null,
  is_public boolean default false not null,
  template_data jsonb not null default '{}'::jsonb,
  usage_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  deleted_at timestamp with time zone default null,
  check (category in ('series', 'film', 'shorts', 'documentary', 'educational')),
  check (usage_count >= 0),
  -- System templates have no account_id, custom templates must have one
  check ((is_system = true and account_id is null) or (is_system = false and account_id is not null))
);

comment on table public.project_templates is 'Project templates for Film Studio - system and custom';
comment on column public.project_templates.account_id is 'NULL for system templates, account UUID for custom templates';
comment on column public.project_templates.category is 'Template category: series, film, shorts, documentary, educational';
comment on column public.project_templates.is_system is 'System-provided template (available to all accounts)';
comment on column public.project_templates.is_public is 'Whether custom template is shared within the organization';
comment on column public.project_templates.template_data is 'JSONB containing project settings, sample characters, locations, etc.';
comment on column public.project_templates.usage_count is 'Number of times template has been used to create projects';
comment on column public.project_templates.deleted_at is 'Soft delete timestamp';

-- Indexes for project_templates
create index if not exists idx_project_templates_account_id on public.project_templates(account_id)
  where account_id is not null and deleted_at is null;
create index if not exists idx_project_templates_category on public.project_templates(category)
  where deleted_at is null;
create index if not exists idx_project_templates_system on public.project_templates(is_system)
  where is_system = true and deleted_at is null;
create index if not exists idx_project_templates_public on public.project_templates(account_id, is_public)
  where is_public = true and deleted_at is null;
create index if not exists idx_project_templates_usage on public.project_templates(usage_count desc)
  where deleted_at is null;
create index if not exists idx_project_templates_deleted_at on public.project_templates(deleted_at)
  where deleted_at is not null;

-- Timestamps trigger for project_templates
create trigger project_templates_set_timestamps
before insert or update on public.project_templates
for each row execute function public.trigger_set_timestamps();

-- ==================================
-- RLS Policies for Project Templates
-- ==================================

alter table public.project_templates enable row level security;

-- Revoke default permissions
revoke all on public.project_templates from authenticated, service_role;

-- Grant specific permissions
grant select, insert, update, delete on table public.project_templates to authenticated;
grant select, insert, update, delete on table public.project_templates to service_role;

-- SELECT: Can read system templates OR own account templates
create policy "project_templates_read" on public.project_templates for select
  to authenticated using (
    deleted_at is null
    and (
      -- System templates are readable by everyone
      is_system = true
      or
      -- User's own account templates
      account_id in (
        select a.id from public.accounts a
        where a.primary_owner_user_id = auth.uid()
        or public.has_role_on_account(a.id)
      )
    )
  );

-- INSERT: Can only create templates for accounts user has access to (not system templates)
create policy "project_templates_create" on public.project_templates for insert
  to authenticated with check (
    is_system = false
    and account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- UPDATE: Can only update own account templates (not system templates)
create policy "project_templates_update" on public.project_templates for update
  to authenticated using (
    is_system = false
    and deleted_at is null
    and account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- DELETE: Can only delete own account templates (not system templates)
create policy "project_templates_delete" on public.project_templates for delete
  to authenticated using (
    is_system = false
    and account_id in (
      select a.id from public.accounts a
      where a.primary_owner_user_id = auth.uid()
      or public.has_role_on_account(a.id)
    )
  );

-- ==================================
-- Function to increment usage count
-- ==================================
-- Called when creating a project from template
-- SECURITY NOTE: Uses SECURITY DEFINER to bypass RLS for atomic update,
-- but validates that user has read access to the template first.

create or replace function public.increment_template_usage(template_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  template_record record;
begin
  -- First verify the template exists and user has read access
  -- System templates are accessible to all, custom templates require account access
  select id, is_system, account_id into template_record
  from public.project_templates
  where id = template_id
    and deleted_at is null
    and (
      is_system = true
      or account_id in (
        select a.id from public.accounts a
        where a.primary_owner_user_id = auth.uid()
        or public.has_role_on_account(a.id)
      )
    );

  -- If no record found, user doesn't have access or template doesn't exist
  if template_record.id is null then
    raise exception 'Template not found or access denied';
  end if;

  -- Now safe to increment the usage count
  update public.project_templates
  set usage_count = usage_count + 1,
      updated_at = now()
  where id = template_id
    and deleted_at is null;
end;
$$;

grant execute on function public.increment_template_usage(uuid) to authenticated;

-- ==================================
-- System Templates Seed Data
-- ==================================

INSERT INTO public.project_templates (
  id, account_id, name, description, thumbnail_url, category, genre,
  target_duration_minutes, is_system, is_public, template_data, usage_count
) VALUES
-- 1. YouTube Series Template
(
  'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  NULL,
  'YouTube Series Starter',
  'Perfect for creating episodic content for YouTube. Includes settings optimized for engagement and recommended episode structure.',
  NULL,
  'series',
  'entertainment',
  15,
  true,
  false,
  '{
    "projectSettings": {
      "projectType": "series",
      "targetPlatforms": ["youtube"],
      "videoStyle": "cinematic",
      "defaultAspectRatio": "16:9",
      "defaultDuration": 5,
      "defaultProvider": "kling",
      "language": "en",
      "subtitlesEnabled": true
    },
    "sampleCharacters": [
      {
        "name": "Host Character",
        "description": "The main presenter or narrator of the series",
        "role": "protagonist",
        "personality": "Engaging, knowledgeable, and relatable"
      },
      {
        "name": "Supporting Character",
        "description": "A recurring guest or co-host",
        "role": "supporting"
      }
    ],
    "sampleLocations": [
      {
        "name": "Main Studio",
        "description": "Primary filming location with consistent branding",
        "visualStyle": "Modern, well-lit studio setup"
      }
    ],
    "storyStructure": {
      "acts": 3,
      "episodeCount": 10,
      "episodeDuration": 15,
      "plotPoints": [
        {"name": "Hook", "description": "Attention-grabbing opening"},
        {"name": "Content", "description": "Main value delivery"},
        {"name": "CTA", "description": "Call to action and preview"}
      ]
    }
  }'::jsonb,
  0
),
-- 2. Short Film Template
(
  'a47ac10b-58cc-4372-a567-0e02b2c3d480',
  NULL,
  'Cinematic Short Film',
  'A template for creating compelling short films with cinematic quality. Includes three-act structure and character archetypes.',
  NULL,
  'film',
  'drama',
  10,
  true,
  false,
  '{
    "projectSettings": {
      "projectType": "short-film",
      "targetPlatforms": ["youtube", "custom"],
      "videoStyle": "cinematic",
      "defaultAspectRatio": "21:9",
      "defaultDuration": 5,
      "defaultProvider": "runway",
      "contentRating": "PG",
      "language": "en"
    },
    "sampleCharacters": [
      {
        "name": "Protagonist",
        "description": "The central character with a clear goal",
        "role": "protagonist",
        "physicalAttributes": {"age": "30s", "build": "average"}
      },
      {
        "name": "Antagonist",
        "description": "The opposing force or obstacle",
        "role": "antagonist"
      },
      {
        "name": "Mentor",
        "description": "Wise character who guides the protagonist",
        "role": "supporting"
      }
    ],
    "sampleLocations": [
      {
        "name": "Opening Scene",
        "description": "Establishes the world and tone",
        "timeOfDay": "dawn"
      },
      {
        "name": "Climax Location",
        "description": "Where the main conflict reaches its peak",
        "timeOfDay": "night"
      }
    ],
    "storyStructure": {
      "acts": 3,
      "plotPoints": [
        {"name": "Setup", "description": "Introduce characters and world"},
        {"name": "Inciting Incident", "description": "Event that starts the journey"},
        {"name": "Rising Action", "description": "Building tension"},
        {"name": "Climax", "description": "Peak of conflict"},
        {"name": "Resolution", "description": "New equilibrium"}
      ]
    },
    "styleGuide": {
      "tone": "Emotional and atmospheric",
      "audioStyle": "Orchestral score with ambient sounds"
    }
  }'::jsonb,
  0
),
-- 3. TikTok Shorts Template
(
  'b47ac10b-58cc-4372-a567-0e02b2c3d481',
  NULL,
  'TikTok Viral Shorts',
  'Optimized for TikTok and Instagram Reels. Fast-paced, vertical format with hook-first structure.',
  NULL,
  'shorts',
  'entertainment',
  1,
  true,
  false,
  '{
    "projectSettings": {
      "projectType": "short-film",
      "targetPlatforms": ["tiktok", "instagram"],
      "videoStyle": "commercial",
      "defaultAspectRatio": "9:16",
      "defaultDuration": 3,
      "defaultProvider": "kling",
      "language": "en"
    },
    "sampleCharacters": [
      {
        "name": "Creator Avatar",
        "description": "Relatable main character or presenter",
        "role": "protagonist",
        "personality": "Energetic, trendy, authentic"
      }
    ],
    "sampleLocations": [
      {
        "name": "Trending Background",
        "description": "Eye-catching, on-trend setting",
        "visualStyle": "Vibrant colors, clean aesthetic"
      }
    ],
    "storyStructure": {
      "acts": 1,
      "episodeDuration": 1,
      "plotPoints": [
        {"name": "Hook", "description": "First 3 seconds - grab attention"},
        {"name": "Value", "description": "Main content or message"},
        {"name": "Loop Point", "description": "Ending that encourages replay"}
      ]
    }
  }'::jsonb,
  0
),
-- 4. Documentary Template
(
  'c47ac10b-58cc-4372-a567-0e02b2c3d482',
  NULL,
  'Documentary Project',
  'For creating informative documentary-style content. Includes interview setups and B-roll organization.',
  NULL,
  'documentary',
  'documentary',
  30,
  true,
  false,
  '{
    "projectSettings": {
      "projectType": "documentary",
      "targetPlatforms": ["youtube", "custom"],
      "videoStyle": "documentary",
      "defaultAspectRatio": "16:9",
      "defaultDuration": 5,
      "defaultProvider": "runway",
      "contentRating": "PG",
      "language": "en",
      "subtitlesEnabled": true
    },
    "sampleCharacters": [
      {
        "name": "Narrator",
        "description": "Voice guiding the documentary",
        "role": "supporting"
      },
      {
        "name": "Subject 1",
        "description": "Primary interview subject or expert",
        "role": "protagonist"
      },
      {
        "name": "Subject 2",
        "description": "Secondary perspective or witness",
        "role": "supporting"
      }
    ],
    "sampleLocations": [
      {
        "name": "Interview Setup",
        "description": "Professional interview background",
        "visualStyle": "Clean, professional lighting"
      },
      {
        "name": "B-Roll Location 1",
        "description": "Supporting footage location",
        "visualStyle": "Documentary style"
      }
    ],
    "storyStructure": {
      "acts": 5,
      "plotPoints": [
        {"name": "Introduction", "description": "Set the context and hook"},
        {"name": "Background", "description": "Historical or contextual information"},
        {"name": "Development", "description": "Main investigation or exploration"},
        {"name": "Climax", "description": "Key revelation or turning point"},
        {"name": "Conclusion", "description": "Reflection and takeaways"}
      ]
    },
    "styleGuide": {
      "tone": "Informative yet engaging",
      "audioStyle": "Subtle ambient music, natural sound design"
    }
  }'::jsonb,
  0
),
-- 5. Educational Content Template
(
  'd47ac10b-58cc-4372-a567-0e02b2c3d483',
  NULL,
  'Educational Course',
  'Perfect for online courses, tutorials, and educational content. Structured for learning objectives and knowledge retention.',
  NULL,
  'educational',
  'education',
  20,
  true,
  false,
  '{
    "projectSettings": {
      "projectType": "educational",
      "targetPlatforms": ["youtube", "custom"],
      "videoStyle": "vlog",
      "defaultAspectRatio": "16:9",
      "defaultDuration": 5,
      "defaultProvider": "kling",
      "language": "en",
      "subtitlesEnabled": true
    },
    "sampleCharacters": [
      {
        "name": "Instructor",
        "description": "Expert teacher or presenter",
        "role": "protagonist",
        "personality": "Knowledgeable, patient, encouraging"
      },
      {
        "name": "Student Avatar",
        "description": "Represents the learner for demonstrations",
        "role": "supporting"
      }
    ],
    "sampleLocations": [
      {
        "name": "Teaching Environment",
        "description": "Clean, distraction-free learning space",
        "visualStyle": "Professional but approachable"
      },
      {
        "name": "Demonstration Area",
        "description": "Space for practical examples",
        "visualStyle": "Well-lit, organized"
      }
    ],
    "storyStructure": {
      "acts": 4,
      "episodeCount": 10,
      "episodeDuration": 20,
      "plotPoints": [
        {"name": "Learning Objective", "description": "What viewers will learn"},
        {"name": "Concept Introduction", "description": "Core teaching content"},
        {"name": "Demonstration", "description": "Practical application"},
        {"name": "Summary & Practice", "description": "Recap and exercises"}
      ]
    },
    "styleGuide": {
      "tone": "Clear, encouraging, structured",
      "audioStyle": "Clean voiceover with subtle background music"
    }
  }'::jsonb,
  0
);
