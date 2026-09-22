---
spec_id: FILM-1202
title: Network Content Strategy & Revenue
status: ✅ DONE
audited: 2026-09-23
effort: M
dependencies: FILM-805, FILM-810
---

# Network Content Strategy & Revenue Model

## 1. Executive Summary

This document is both a **strategic playbook** and an **engineering map** for launching and operating the Storybook Network — 5 diversified niche channels anchored by high-consistency IP characters, produced at scale using the Storybook OS (`@kit/*` packages), and distributed across 5 key languages (English, Hindi, Bengali, Spanish, Portuguese).

**Core Strategy:** Avoid "News" (low shelf-life) in favor of "Evergreen" content (high rewatchability) driven by recurring characters.

> [!IMPORTANT]
> This spec maps every strategic concept to concrete codebase paths, so AI agents can navigate and execute any part of the strategy without additional context.

---

## 2. Niche Differentiation & Brand Identity Matrix

| Niche | Character Anchor | Archetype | Target Audience | Brand Vibe | Key Languages |
|-------|------------------|-----------|-----------------|------------|---------------|
| **Kids Mystery** | **Little Detective Dante** | The Curious Child | Kids 4-9 & Parents | Playful, Educational, Safe | En, Es, Hi |
| **Futurism / Tech** | **Cassandra Advance** | The Visionary | Tech enthusiasts, Gen Z | Sleek, Neon, Optimistic | En, Es, Pt |
| **Education / Science** | **Professor Babu Chondo** | The Eccentric Genius | Students, Lifelong Learners | Warm, Whimsical, Intellectual | Bn, Hi, En |
| **True Crime / Noir** | **Detective Nocturne (Sterling)** | The Hardboiled Sleuth | Adults 18-45 | Gritty, Shadowy, Atmospheric | En, Es, Pt |
| **Philosophy / Strategy** | **The Architect (Silent Sage)** | The Stoic Guide | Professionals, Thinkers | Minimalist, Calm, Abstract | En, Hi |

### Cross-Niche Content Differentiation

How different channels interpret the **same topic** shows niche branding power:

| Channel | Character | Angle | Hook |
|---------|-----------|-------|------|
| **True Crime / Noir** | Detective Nocturne | The Cold Case: gritty 1888 London, police failures, psychological profiling | *"The fog didn't hide him. The city's indifference did."* |
| **Futurism / Tech** | Cassandra Advance | The Forensic Future: AI/modern forensics catch-rate, predictive policing | *"If London 1888 had CCTV, Jack would have lasted 6 hours, not 6 months."* |
| **Kids Mystery** | Little Detective Dante | The "Spooky" Legend (sanitized): teaches deduction via playful narrative | *"Who is hiding in the London fog? Let's use our map to find him!"* |

---

## 3. Character Deep-Dives

### 3.1 Little Detective Dante
- **Visuals:** 6-year-old, oversized trench coat, magnifying glass. Anime-lite style.
- **Personality:** Optimistic, notices what adults miss, fourth-wall breaks for viewer interaction.
- **Hook:** "Can YOU spot the clue?" (Interactive retention).

### 3.2 Cassandra Advance
- **Visuals:** CP77-aesthetic cyborg. Holographic interfaces.
- **Personality:** Fast-talking, data-driven, excited about the future but wary of glitches.
- **Hook:** "The Future is already here, it's just not evenly distributed."

### 3.3 Professor Babu Chondo
- **Visuals:** Older Bengali gentleman, wild white hair, thick glasses, steampunk rickshaw.
- **Personality:** Explains complex physics using everyday metaphors (gravity via a mango).
- **Hook:** "Science is everywhere, even in your cup of chai."

### 3.4 Detective Sterling (Nocturne)
- **Visuals:** Silhouette-heavy, 1940s aesthetics, fog/vapor, rain-soaked streets.
- **Personality:** Cynical but moral. Inner monologue narration.
- **Hook:** "The city never sleeps, and neither does the truth."

### 3.5 The Architect
- **Visuals:** Faceless figure or mask, geometric backgrounds, slow-motion visuals.
- **Personality:** Silent protagonist or voice-over only. Speaks in aphorisms.
- **Hook:** Visual ASMR + Mental Models.

---

## 4. Engineering Map: Setting Up a Channel

Each niche channel maps to a **Team Account → Project** in Storybook. This section maps every operational concept to code.

### 4.1 Create a Team Account & Project

```
Route: /home/teams/create → /home/[account]/studio
```

| Step | UI Route | Server Action | Package |
|------|----------|---------------|---------|
| Create team | `/home/teams/create` | `createTeamAccountAction` | `@kit/team-accounts` |
| Create project | `/home/[account]/studio` | `createProjectAction` | `@kit/projects` |
| Configure metadata | `/home/[account]/studio/[projectId]/settings` | `updateProjectAction` | `@kit/projects` |

**Code References:**
- Team accounts: `packages/features/team-accounts/src/server/`
- Projects: `packages/features/projects/src/server/`
- Project settings page: `apps/web/app/home/[account]/studio/[projectId]/settings/`

### 4.2 Register Character Assets

Characters are stored as **Assets** (type `character`) with visual references for VEO 3.1 prompt consistency.

```
Route: /home/[account]/studio/[projectId]/assets
```

| Step | Action | Code Path |
|------|--------|-----------|
| Upload character reference images | `createAssetAction` | `packages/features/assets/src/lib/` |
| Set character metadata (age, ethnicity, build) | Asset metadata JSONB | `packages/features/assets/src/components/` |
| Register with Canon system | Canon extraction prompts | `packages/features/episodes/src/server/canon-actions.ts` |

**Code References:**
- Asset management: `packages/features/assets/src/` (34 components, 26 lib files)
- Asset types: `character`, `background`, `prop`, `reference_image`, `master_video`, `master_title_card`
- Canon character tracking: `packages/features/episodes/src/server/canon-actions.ts`
- Canon DB tables: `apps/web/supabase/migrations/20260128225704_canon_management.sql`

**Canon Management Tables** (6 tables with RLS):

| Table | Purpose | Insert Policy |
|-------|---------|---------------|
| `immutable_events` | Hard canon facts (deaths, world truths, relationships) | CRUD for project members |
| `character_states` | Append-only character state log (emotional, physical, relationship) | Append-only (audit integrity) |
| `world_states` | Environment/location tracking | CRUD for project members |
| `narrative_threads` | Plot thread lifecycle (open→progressed→resolved) | CRUD for project members |
| `state_deltas` | Immutable change audit log per episode | Append-only |
| `episode_summaries` | Pre-computed memory context (SCORE framework) | CRUD for project members |

### 4.3 Configure Voice Profiles

Each character needs a consistent voice across all episodes and languages.

| Step | Action | Code Path |
|------|--------|-----------|
| Clone voice from sample | `VoiceCloningEditor` | `packages/features/audio-generation/src/components/VoiceCloningEditor.tsx` |
| Assign voice to character | `VoiceSelector` | `packages/features/audio-generation/src/components/VoiceSelector.tsx` |
| Configure voice settings | `VoiceSettings` | `packages/features/audio-generation/src/components/VoiceSettings.tsx` |

**TTS Provider Abstraction:**
- Factory: `packages/features/audio-generation/src/providers/factory.ts`
- Registry: `packages/features/audio-generation/src/providers/registry.ts`
- ElevenLabs: `packages/features/audio-generation/src/providers/elevenlabs.ts`
- Server actions: `packages/features/audio-generation/src/server/voice-clone-actions.ts`

### 4.4 Connect Publishing Platforms

Each channel needs OAuth connections to YouTube, TikTok, Instagram.

```
Route: /home/[account]/studio/[projectId]/publish
```

| Step | Action | Code Path |
|------|--------|-----------|
| Connect YouTube/TikTok/IG | OAuth flow | `packages/features/publishing/src/server/account-oauth-actions.ts` |
| Configure per-platform | App config | `packages/features/publishing/src/components/oauth-app-config.tsx` |
| Platform connections UI | Connections panel | `packages/features/publishing/src/components/platform-connections.tsx` |

**Code References:**
- OAuth: `packages/features/publishing/src/server/global-oauth-actions.ts`
- Connection management: `packages/features/publishing/src/server/connection-actions.ts`
- Platform limits: `packages/features/publishing/src/lib/platform-limits.ts`

---

## 5. Engineering Map: Batch Production Pipeline

The strategy's core advantage — 50+ episodes/month per niche — is enabled by the episode pipeline.

### 5.1 Production Workflow (Per Episode)

```
Ideation → Story → Screenplay → Visual Studio → Audio Studio → Publishing
```

| Stage | UI Route | Server Actions | Prompt Template |
|-------|----------|----------------|-----------------|
| **Ideation** | `/episodes/[id]/ideation` | `generateIdeaAction` | `story-ideation.json` |
| **Story** | `/episodes/[id]/story` | `generateStoryAction` | `story-generation.json` |
| **Screenplay** | `/episodes/[id]/screenplay` | `generateScreenplayAction` | `screenplay-conversion.json` |
| **Visual Studio** | `/episodes/[id]/visual-studio` | `generateShotListAction` | `scene-shot-generation.json` |
| **Audio Studio** | `/episodes/[id]/audio-studio` | Audio TTS + music | `scene-audio-refinement.json` |
| **Publish** | `/episodes/[id]/publish` | `publishAction` | `batch-translate-metadata.json` |

**Episode Routes Base:** `apps/web/app/home/[account]/studio/[projectId]/episodes/[episodeId]/`

**Key Server Action Files:**
- `packages/features/episodes/src/server/story-actions.ts` — Story generation
- `packages/features/episodes/src/server/screenplay-actions.ts` — Scene/screenplay
- `packages/features/episodes/src/server/timeline-actions.ts` — Audio timeline
- `packages/features/episodes/src/server/intro-actions.ts` — Intro generation

### 5.2 Batch Episode Creation

For producing 50 scripts/month per niche:

| Action | Code Path |
|--------|-----------|
| Season generation (batch of 10-26 episodes) | `packages/features/episodes/src/server/batch-episode-actions.ts` |
| Season outline prompt | `packages/features/prompt-engine/src/prompts/story-generation/season-outline.json` |
| Season generation prompt | `packages/features/prompt-engine/src/prompts/story-generation/season-generation.json` |
| Duration-based content scaling | `packages/features/episodes/src/lib/duration-scaling.ts` |

**Duration Scaling API:**
```typescript
import { calculateContentScaling } from '@kit/episodes';

const scaling = calculateContentScaling({
  targetDurationSeconds: 300, // 5 minutes
  contentStyle: 'dialogue-heavy',
});
// Returns: ~750 words, ~7 scenes, ~40 dialogue lines, ~43 shots
```

### 5.3 VEO 3.1 Visual Generation

Each shot generates a 7-component VEO 3.1 optimized prompt using the scene-by-scene pipeline:

```
Build Global Context → Per-Scene Filtering → LLM Generation → Aggregate → Store
```

| Component | Description |
|-----------|-------------|
| Subject | 15+ character attributes (age, ethnicity, hair, eyes, build) |
| Action | Movements, gestures, timing, micro-expressions |
| Scene | Environment, props, lighting, weather |
| Style | Camera shot, angle, movement, aesthetic |
| Dialogue | `"[Name]: 'text' (Tone: emotion)"` — colon syntax prevents subtitles |
| Sounds | Ambient + effects (prevents audio hallucinations) |
| Negative | Exclude subtitles, captions, watermarks |

**Code References:**
- Context builder: `packages/features/episodes/src/server/context-builder.ts`
- Shot generation prompt: `packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json`
- Shot list prompt: `packages/features/prompt-engine/src/prompts/story-generation/shot-list-generation.json`

### 5.4 Multi-Language Dubbing (FILM-512)

Scale 1 video into 5 languages using the audio generation pipeline:

| Action | Code Path |
|--------|-----------|
| Dialogue translation | `packages/features/prompt-engine/src/prompts/audio-generation/dialogue-translation.json` |
| Batch TTS generation | `packages/features/audio-generation/src/server/batch-actions.ts` |
| Voice assignment per character | `packages/features/audio-generation/src/components/VoiceAssignment.tsx` |
| ElevenLabs music generation | `packages/features/audio-generation/src/server/elevenlabs-music-actions.ts` |
| Audio player/waveform | `packages/features/audio-generation/src/components/AudioPlayer.tsx`, `Waveform.tsx` |

**Provider Abstraction:**
- Base provider interface: `packages/features/audio-generation/src/providers/base.ts`
- ElevenLabs: `providers/elevenlabs.ts`
- Suno: `providers/suno.ts`
- Udio: `providers/udio.ts`

### 5.5 Canon-Aware Generation

Every story/screenplay generation injects canon context to enforce character consistency:

| Component | Code Path |
|-----------|-----------|
| Memory context injection | `packages/features/episodes/src/server/canon-actions.ts` |
| Canon extraction after generation | Prompt: `canon-roles/canon-extraction.json` |
| Canon role prompts (editor, planner, stylist, writer) | `packages/features/prompt-engine/src/prompts/canon-roles/` |
| Continuity checking | `packages/features/episodes/src/components/continuity-checker.tsx` |
| Continuity schemas | `packages/features/episodes/src/lib/continuity-schemas.ts` |

### 5.6 Content Type System

Different niches can use different content type configurations (standard episodes, news, documentary):

| Component | Code Path |
|-----------|-----------|
| Content type enum | `packages/features/episodes/src/types/act-context.ts` |
| Act context bridge | Injects act-specific constraints per content type |
| Sequel system | Supports multi-part episodes across seasons |
| Fact-based content (documentary, news) | `packages/features/episodes/src/server/fact-actions.ts` |

---

## 6. Engineering Map: Publishing & Distribution

### 6.1 Publish Hub (FILM-708)

Cross-platform scheduling and publishing for all 5 channels.

| Feature | Code Path |
|---------|-----------|
| Publish Hub UI | `packages/features/publishing/src/components/publish-hub.tsx` |
| Schedule release panel | `packages/features/publishing/src/components/schedule-release-panel.tsx` |
| Metadata editor (title, description, tags) | `packages/features/publishing/src/components/metadata-editor.tsx` |
| Platform-specific settings | `packages/features/publishing/src/components/platform-specific-settings.tsx` |
| Batch metadata translation | `packages/features/prompt-engine/src/prompts/publishing/batch-translate-metadata.json` |
| Publish status tracking | `packages/features/publishing/src/components/publish-status-row.tsx` |

### 6.2 Posting Schedule (Per Channel)

| Format | Frequency | Implementation |
|--------|-----------|----------------|
| YouTube Long | 2x Weekly | `schedule-release-panel.tsx` → cron `process-scheduled-publishes.ts` |
| YouTube Shorts | 1x Daily | `packages/features/shorts/` |
| TikTok/Reels | 2x Daily | Platform-specific publish via `publish-actions.ts` |
| Languages | En (primary), Es/Hi (24h later) | Batch translate → staggered schedule |

**Scheduled Publishing Jobs:**
- Process job: `packages/features/publishing/src/jobs/process-scheduled-publishes.ts`
- Token refresh: `packages/features/publishing/src/jobs/refresh-expiring-tokens.ts`

### 6.3 Shorts Production

| Feature | Code Path |
|---------|-----------|
| Shorts package | `packages/features/shorts/` |
| Magic clips (AI-generated cuts) | `packages/features/prompt-engine/src/prompts/publishing/magic-clips.json` |

---

## 7. Engineering Map: Analytics & Revenue Tracking

### 7.1 Analytics Dashboard (FILM-805)

Full analytics powered by ClickHouse (FILM-1201).

| Feature | Code Path |
|---------|-----------|
| Main dashboard | `packages/features/content-analytics/src/components/analytics-dashboard.tsx` |
| Project dashboard | `packages/features/content-analytics/src/components/project-dashboard.tsx` |
| Account-level dashboard | `packages/features/content-analytics/src/components/company-dashboard.tsx` |
| Episode analytics | `packages/features/content-analytics/src/components/episode-analytics.tsx` |
| Season overview | `packages/features/content-analytics/src/components/season-overview.tsx` |
| Performance chart | `packages/features/content-analytics/src/components/performance-chart.tsx` |
| AI insights | `packages/features/content-analytics/src/components/ai-insights.tsx` |
| Audience analytics | `packages/features/content-analytics/src/components/audience-analytics.tsx` |

### 7.2 Revenue Tracking (FILM-810)

| Feature | Code Path |
|---------|-----------|
| Revenue dashboard | `packages/features/content-analytics/src/components/revenue-dashboard.tsx` |
| Revenue chart | `packages/features/content-analytics/src/components/revenue-chart.tsx` |
| Revenue by platform | `packages/features/content-analytics/src/components/revenue-platform-breakdown.tsx` |
| Top earning content | `packages/features/content-analytics/src/components/revenue-top-content.tsx` |
| Manual revenue entry | `packages/features/content-analytics/src/components/manual-revenue-form.tsx` |
| Revenue overview card | `packages/features/content-analytics/src/components/overview/revenue-card.tsx` |
| Revenue server actions | `packages/features/content-analytics/src/server/revenue-actions.ts` |
| Revenue schema | `packages/features/content-analytics/src/lib/schemas/revenue.schema.ts` |
| Revenue types | `packages/features/content-analytics/src/lib/types/revenue.ts` |

### 7.3 Language Analytics

Track per-language performance across all 5 channel languages:

| Feature | Code Path |
|---------|-----------|
| Language analytics dashboard | `packages/features/content-analytics/src/components/language-analytics-dashboard.tsx` |
| Language analytics cards | `packages/features/content-analytics/src/components/language-analytics-cards.tsx` |
| Language trend chart | `packages/features/content-analytics/src/components/language-trend-chart.tsx` |
| Language insights | `packages/features/content-analytics/src/components/language-insights-cards.tsx` |
| Language analytics server | `packages/features/content-analytics/src/server/language-analytics.ts` |
| Language insights prompt | `packages/features/prompt-engine/src/prompts/analytics/language-insights.json` |

### 7.4 ClickHouse Analytics Backend (FILM-1201)

All analytics queries run against ClickHouse for sub-second performance at scale.

| Component | Code Path |
|-----------|-----------|
| ClickHouse client (singleton) | `packages/clickhouse/src/client.ts` |
| Typed query functions (10+) | `packages/clickhouse/src/queries.ts` |
| Types (VideoMetric, DailyStats, etc.) | `packages/clickhouse/src/types.ts` |
| DDL migrations | `packages/clickhouse/src/migrations/001_create_tables.ts` |
| Analytics sync cron (Supabase → CH) | `packages/features/content-analytics/src/server/analytics-sync-cron.ts` |
| Aggregation queries | `packages/features/content-analytics/src/server/aggregation-queries.ts` |

**ClickHouse Schema:**

| Table | Type | Purpose |
|-------|------|---------|
| `video_metrics` | MergeTree | Raw event ingestion (partitioned by month) |
| `video_daily_stats` | SummingMergeTree (Materialized View) | Pre-aggregated daily stats |

### 7.5 Reporting

| Feature | Code Path |
|---------|-----------|
| Export reports (CSV/PDF) | `packages/features/content-analytics/src/components/export-reports.tsx` |
| CSV generator | `packages/features/content-analytics/src/lib/csv-generator.ts` |
| PDF generator | `packages/features/content-analytics/src/lib/pdf-generator.tsx` |
| Scheduled reports | `packages/features/content-analytics/src/components/scheduled-reports-manager.tsx` |
| Report server actions | `packages/features/content-analytics/src/server/report-actions.ts` |
| AI-powered insights generation | `packages/features/prompt-engine/src/prompts/analytics/insights-generation.json` |

---

## 8. Prompt Engine: Complete Template Registry

All LLM interactions use the JSON-based prompt engine. Full registry of templates:

### Story Generation
| Template | File | Used By |
|----------|------|---------|
| Story Ideation | `story-generation/story-ideation.json` | Ideation stage |
| Story Generation | `story-generation/story-generation.json` | Story stage |
| Screenplay Conversion | `story-generation/screenplay-conversion.json` | Screenplay stage |
| Scene Shot Generation | `story-generation/scene-shot-generation.json` | Visual Studio |
| Shot List Generation | `story-generation/shot-list-generation.json` | Visual Studio (legacy) |
| Season Outline | `story-generation/season-outline.json` | Batch creation |
| Season Generation | `story-generation/season-generation.json` | Batch creation |

### Canon Roles
| Template | File | Used By |
|----------|------|---------|
| Canon Extraction | `canon-roles/canon-extraction.json` | Post-generation extraction |
| Editor Role | `canon-roles/editor-role.json` | Editing pass |
| Planner Role | `canon-roles/planner-role.json` | Pre-production planning |
| Stylist Role | `canon-roles/stylist-role.json` | Visual style enforcement |
| Writer Role | `canon-roles/writer-role.json` | Narrative generation |

### Audio & Publishing
| Template | File | Used By |
|----------|------|---------|
| Dialogue Translation | `audio-generation/dialogue-translation.json` | Multi-language dubbing |
| Scene Audio Refinement | `audio-generation/scene-audio-refinement.json` | Audio Studio |
| Batch Translate Metadata | `publishing/batch-translate-metadata.json` | Publish stage (titles, descriptions) |
| Magic Clips | `publishing/magic-clips.json` | Shorts/clips extraction |

### Research & News
| Template | File | Used By |
|----------|------|---------|
| Researcher Role | `documentary/researcher-role.json` | Fact-based content |
| Fact-Checker Role | `documentary/fact-checker-role.json` | Verification |
| Anchor Role | `news-generation/anchor-role.json` | News content type |
| Producer Role | `news-generation/producer-role.json` | News content type |
| Entity Extraction | `news-generation/entity-extraction.json` | News entities |
| Topic Summary | `news-generation/topic-summary.json` | News summarization |

### Analytics
| Template | File | Used By |
|----------|------|---------|
| Insights Generation | `analytics/insights-generation.json` | AI-powered insights |
| Language Insights | `analytics/language-insights.json` | Per-language analysis |

### Movie
| Template | File | Used By |
|----------|------|---------|
| Act Context Extraction | `movie/act-context-extraction.json` | Long-form act structure extraction |

**Prompt Engine Base Path:** `packages/features/prompt-engine/src/prompts/`

---

## 9. First 10 Episodes: Season 1 Roadmap (Little Detective Dante)

| Ep | Title | Logline | Key Asset |
|----|-------|---------|-----------| 
| 1 | The Case of the Missing Apple | Dante finds a wormhole in the fruit bowl. | Kitchen Set |
| 2 | The Shadow that Moved | A lost cat is hiding in the shadows. | Backyard Set |
| 3 | Who Ate the Cookie? | Crumb analysis leads to dad. | Living Room |
| 4 | The Silent Bird | Why did the canary stop singing? (It's molting). | Cage Prop |
| 5 | The Wet Pavement | It hasn't rained, so why is it wet? (Sprinklers). | Street Set |
| 6 | The Echo in the Hall | Learning about sound waves. | School Hall |
| 7 | The Floating Feather | Gravity vs Air Resistance. | Park Set |
| 8 | The Locked Box | Using magnets to open a latch. | Bedroom Set |
| 9 | The Invisible Ink | Lemon juice messages. | Laboratory |
| 10 | The Season Finale: The Lost Key | Dante finds the key to the attic. | Attic Set |

---

## 10. Projected Revenue (24 Months)

**Assumptions:**
- **RPM (Revenue Per Mille):** US ($5), IN ($1), ES ($2).
- **Growth:** 20% MoM (Viral compounding).
- **Monetization:** Ads (Primary), Merch (Secondary, starts Month 12).

### Monthly Recurring Revenue (MRR) Projection

| Month | Total Views (Agg) | Ad Revenue (Est) | Merch/Sponsors | Total Revenue |
|-------|-------------------|------------------|----------------|---------------|
| M1 | 50,000 | $100 | $0 | **$100** |
| M3 | 500,000 | $1,200 | $0 | **$1,200** |
| M6 | 2,500,000 | $5,500 | $0 | **$5,500** |
| M9 | 8,000,000 | $16,000 | $0 | **$16,000** |
| M12 | 20,000,000 | $40,000 | $5,000 | **$45,000** |
| M18 | 60,000,000 | $120,000 | $20,000 | **$140,000** |
| M24 | 150,000,000 | $300,000 | $50,000 | **$350,000** |

Revenue tracked via `revenue-actions.ts` (FILM-810) and visualized in the Analytics Dashboard (FILM-805), powered by ClickHouse (FILM-1201).

---

## 11. Package Dependency Map

```
@kit/projects (project setup)
  ├── @kit/team-accounts (team/channel ownership)
  ├── @kit/assets (character images, reference art)
  └── @kit/episodes (content pipeline)
        ├── @kit/prompt-engine (25 LLM prompt templates)
        │     ├── story-generation/ (7 templates)
        │     ├── canon-roles/ (5 templates)
        │     ├── audio-generation/ (2 templates)
        │     ├── publishing/ (2 templates)
        │     ├── documentary/ (2 templates)
        │     ├── news-generation/ (4 templates)
        │     ├── analytics/ (2 templates)
        │     └── movie/ (1 template)
        ├── @kit/audio-generation (TTS, voice cloning, music)
        │     ├── providers/ (ElevenLabs, Suno, Udio)
        │     └── components/ (14 UI components)
        ├── @kit/film-studio (visual generation, captions, API keys)
        └── @kit/publishing (Publish Hub, scheduling, OAuth)
              └── @kit/content-analytics (ClickHouse analytics, revenue)
                    └── @kit/clickhouse (query engine)
```

---

## 12. Quick Reference: Key File Paths

| Concern | Primary Path |
|---------|-------------|
| Episode pipeline | `packages/features/episodes/src/` |
| Story generation | `packages/features/episodes/src/server/story-actions.ts` |
| Shot generation | `packages/features/episodes/src/server/` + `context-builder.ts` |
| Audio / TTS / Voice | `packages/features/audio-generation/src/` |
| Voice cloning | `packages/features/audio-generation/src/server/voice-clone-actions.ts` |
| Music generation | `packages/features/audio-generation/src/server/elevenlabs-music-actions.ts` |
| Publishing | `packages/features/publishing/src/` |
| OAuth connections | `packages/features/publishing/src/server/account-oauth-actions.ts` |
| Revenue | `packages/features/content-analytics/src/server/revenue-actions.ts` |
| Analytics (ClickHouse) | `packages/clickhouse/src/` |
| Canon management | `packages/features/episodes/src/server/canon-actions.ts` |
| Canon DB schema | `apps/web/supabase/migrations/20260128225704_canon_management.sql` |
| Prompt templates | `packages/features/prompt-engine/src/prompts/` |
| Assets (characters) | `packages/features/assets/src/` |
| Shorts | `packages/features/shorts/` |
| Batch episodes | `packages/features/episodes/src/server/batch-episode-actions.ts` |
| Duration scaling | `packages/features/episodes/src/lib/duration-scaling.ts` |
| Continuity checking | `packages/features/episodes/src/components/continuity-checker.tsx` |
