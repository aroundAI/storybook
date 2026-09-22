# Product Requirements Document (PRD)
# Unified AI Cinematic Film Studio

**Version:** 2.1  
**Date:** December 2025  
**Author:** Product Team  
**Status:** Historical baseline — the original product scope, as written in December 2025. Not maintained: what has shipped since, what was retired, and what is left are in [INDEX.md](./INDEX.md).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Product Vision & Goals](#2-product-vision--goals)
3. [User Personas](#3-user-personas)
4. [Project Types & Hierarchy](#4-project-types--hierarchy)
5. [Core Feature Modules](#5-core-feature-modules)
6. [Detailed User Flows](#6-detailed-user-flows)
7. [Screen-by-Screen Specification](#7-screen-by-screen-specification)
8. [API Integrations & Vendor Analysis](#8-api-integrations--vendor-analysis)
9. [Pricing & Cost Engine](#9-pricing--cost-engine)
10. [Publishing & Distribution](#10-publishing--distribution)
11. [Analytics & Insights](#11-analytics--insights)
12. [Technical Architecture](#12-technical-architecture)
13. [Database Schema](#13-database-schema)
14. [Non-Functional Requirements](#14-non-functional-requirements)
15. [Roadmap & Phases](#15-roadmap--phases)
16. [Appendix](#16-appendix)

---

## 1. Executive Summary

### 1.1 Problem Statement

Creating AI-generated cinematic content currently requires juggling 8-12 different tools:

| Current Tool | Purpose | Pain Point |
|--------------|---------|------------|
| ChatGPT/Claude | Script & prompt writing | No asset context |
| Midjourney/Flux | Character design | Separate from video pipeline |
| Kling/Runway/Hailuo | Video generation | 5-10s clips, manual stitching |
| ElevenLabs | Voice generation | Separate sync workflow |
| Suno/Udio | Music generation | Manual export/import |
| Premiere Pro/DaVinci | Editing & stitching | Expensive, learning curve |
| Canva/Figma | Thumbnails & graphics | Another tool to manage |
| YouTube Studio | Publishing | Manual upload per platform |
| Social Media Apps | Cross-posting | Repetitive manual work |
| Google Analytics | Performance tracking | Fragmented data |

**Total monthly cost for a creator:** $200-500+ across subscriptions  
**Time overhead:** 60-70% spent on tool-switching, not creating

### 1.2 Solution

A unified web application that consolidates the entire AI cinematic production pipeline—from story ideation to published content with analytics—into a single platform.

### 1.3 Key Value Propositions

1. **End-to-End Production:** Story → Screenplay → Storyboard → Video → Audio → Edit → Publish
2. **Intelligent Automation:** AI handles repetitive tasks (stitching, syncing, scheduling)
3. **Asset Continuity:** Characters, locations, and styles persist across episodes
4. **Multi-Platform Distribution:** One-click publishing to 10+ platforms
5. **Data-Driven Insights:** Unified analytics across all platforms
6. **Flexible Entry Points:** Use full pipeline OR just publishing features

---

## 2. Product Vision & Goals

### 2.1 Vision Statement

> "Democratize cinematic AI content creation by providing a Hollywood-grade production studio in the browser, accessible to solo creators and teams alike."

### 2.2 Product Goals

| Goal | Metric | Target |
|------|--------|--------|
| Reduce production time | Time from concept to publish | < 4 hours for 5-min episode |
| Lower barrier to entry | Tools required | 1 (this app) |
| Increase output consistency | Character consistency score | > 85% across episodes |
| Maximize distribution reach | Platforms per publish | 10+ simultaneous |
| Enable data-driven decisions | Analytics latency | < 24 hours |

### 2.3 Success Metrics (KPIs)

| KPI | Definition | Target (Year 1) |
|-----|------------|-----------------|
| MAU | Monthly Active Users | 50,000 |
| Episodes Published | Total episodes created | 500,000 |
| Creator Retention | 90-day retention | 40% |
| Avg. Episodes/Creator/Month | Production velocity | 8 |
| Platform NPS | Net Promoter Score | > 50 |

---

## 3. User Personas

### 3.1 Primary Personas

#### Persona 1: Solo AI Creator ("Alex")

| Attribute | Detail |
|-----------|--------|
| **Background** | Part-time content creator, full-time job elsewhere |
| **Goal** | Build a children's cartoon channel with minimal effort |
| **Technical Skill** | Moderate (can write prompts, basic editing) |
| **Budget** | $100-300/month |
| **Pain Points** | Too many tools, inconsistent characters, manual publishing |
| **Key Needs** | Automation, templates, character consistency |

#### Persona 2: Content Studio ("Studio Spark")

| Attribute | Detail |
|-----------|--------|
| **Background** | Small team (3-5 people) producing multiple shows |
| **Goal** | Scale production to 20+ episodes/week across 5 shows |
| **Technical Skill** | High (dedicated prompt engineers, editors) |
| **Budget** | $1,000-5,000/month |
| **Pain Points** | Collaboration, version control, brand consistency |
| **Key Needs** | Team features, asset libraries, bulk operations |

#### Persona 3: Traditional Creator ("Maria")

| Attribute | Detail |
|-----------|--------|
| **Background** | YouTuber who shoots real video content |
| **Goal** | Streamline publishing and grow across platforms |
| **Technical Skill** | Low-moderate |
| **Budget** | $50-100/month |
| **Pain Points** | Manual cross-posting, fragmented analytics |
| **Key Needs** | Upload → Distribute → Analyze (no generation) |

### 3.2 Secondary Personas

- **Brand/Agency:** Uses platform for client campaigns
- **Educator:** Creates educational content for children
- **Hobbyist:** Experiments with AI video for fun

---

## 4. Project Types & Hierarchy

### 4.1 Content Hierarchy

```
Organization (Workspace)
├── Project (Show/Series OR Film)
│   ├── Asset Library (Project-Scoped)
│   │   ├── Characters
│   │   ├── Locations
│   │   ├── Props
│   │   ├── Music
│   │   ├── Voice Profiles
│   │   └── Style Guide
│   ├── Season (optional, for Series)
│   │   ├── Episode
│   │   │   ├── Scenes
│   │   │   ├── Shots
│   │   │   └── Assets Used (references)
│   │   └── Episode...
│   └── Season...
├── Project...
└── Shared Resources (Organization-Level)
    ├── SFX Library (generic sounds)
    ├── Music Templates (royalty-free tracks)
    └── Style Presets
```

**Key Design Decision:** Assets are scoped to projects, not global. This ensures:
- "Dante" character belongs only to "Little Detective Dante"
- "Folktale Village" location belongs only to "Tales from Folktales"
- Voice profiles match specific characters
- No accidental cross-contamination between shows

**Shared Resources** at the organization level include only generic, reusable items (SFX, royalty-free music) that don't define a show's identity.

### 4.2 Project Types

#### Type A: Series/Show

| Attribute | Description |
|-----------|-------------|
| **Definition** | Episodic content with recurring characters, settings, themes |
| **Structure** | Seasons → Episodes |
| **Examples** | "Little Detective Dante," "Tales from Folktales," "Baby Engineer Dario" |
| **Key Features** | Character bible, episode templates, story continuity tracking |
| **Typical Length** | 3-10 minutes per episode |
| **Publishing Cadence** | Daily/Weekly |

#### Type B: Cinema/Film

| Attribute | Description |
|-----------|-------------|
| **Definition** | Standalone long-form content |
| **Structure** | Acts → Scenes |
| **Examples** | Short films, documentaries, music videos |
| **Key Features** | Act structure templates, cinematic presets |
| **Typical Length** | 10-60 minutes |
| **Publishing Cadence** | One-time or limited series |

#### Type C: Shorts Collection

| Attribute | Description |
|-----------|-------------|
| **Definition** | Collection of short-form vertical content |
| **Structure** | Flat (individual shorts) |
| **Examples** | TikTok series, YouTube Shorts compilations |
| **Key Features** | Vertical templates, trending audio integration |
| **Typical Length** | 15-60 seconds each |
| **Publishing Cadence** | Multiple per day |

### 4.3 Project Configuration

When creating a new project, users configure:

| Setting | Options | Default |
|---------|---------|---------|
| Project Type | Series, Film, Shorts Collection | Series |
| Aspect Ratio | 16:9, 9:16, 1:1, 4:5 | 16:9 |
| Default Resolution | 720p, 1080p, 4K | 1080p |
| Target Platforms | Multi-select | YouTube, Instagram |
| Content Rating | G, PG, PG-13, R | G |
| Primary Language | 50+ languages | English |
| Episode Length Target | Minutes | 5 |
| Art Style | Realistic, Cartoon, Anime, etc. | Cartoon |
| Generation Model | Kling, Runway, Hailuo, etc. | Kling 2.5 Turbo |

### 4.4 Asset Import Between Projects

Since assets are project-scoped, users may need to reuse assets across projects. This is handled via explicit **copy** (not link):

| Action | Description |
|--------|-------------|
| **Import from Project** | Copy selected assets from another project into current project |
| **Import from Shared** | Copy generic SFX/music from organization's shared library |
| **Bulk Import** | Import multiple assets at once |
| **Import with Variants** | Copy and modify (e.g., same character in different outfit) |

**Why Copy Instead of Link?**
- Prevents accidental changes affecting multiple projects
- Each project maintains full ownership of its assets
- Allows divergent evolution (Dante v1 vs Dante v2)
- Cleaner data model

---

## 5. Core Feature Modules

### 5.1 Module Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI CINEMATIC FILM STUDIO                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ PROJECT  │  │  STORY   │  │  VISUAL  │  │  AUDIO   │        │
│  │   HUB    │→ │  STUDIO  │→ │  STUDIO  │→ │  STUDIO  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│       ↓                                          ↓              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │  ASSET   │  │  EDIT    │  │ PUBLISH  │  │ ANALYTICS│        │
│  │ LIBRARY  │  │  SUITE   │→ │   HUB    │→ │ DASHBOARD│        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 Module Specifications

#### Module 1: Project Hub

| Feature | Description | Priority |
|---------|-------------|----------|
| Project Creation Wizard | Guided setup for new projects | P0 |
| Project Dashboard | Overview of project status, recent activity | P0 |
| Season/Episode Manager | CRUD for seasons and episodes | P0 |
| Team Collaboration | Invite members, assign roles | P1 |
| Project Templates | Pre-built structures for common formats | P1 |
| Project Cloning | Duplicate project settings for new show | P2 |

#### Module 2: Asset Library (Project-Scoped)

**Scope:** Each project has its own Asset Library. Assets do not leak between projects.

| Feature | Description | Priority |
|---------|-------------|----------|
| Character Manager | Create, store, version character assets | P0 |
| Location Manager | Background/environment assets | P0 |
| Prop Library | Reusable objects and items | P1 |
| Style Guide | Color palettes, art direction rules | P1 |
| Voice Profile Manager | Stored voice configurations per character | P0 |
| Music Library | Project-specific generated/uploaded tracks | P1 |
| Asset Search | Full-text and tag-based search within project | P0 |
| Asset Versioning | Track changes to assets over time | P2 |
| Import from Project | Copy assets from another project (with permission) | P2 |
| Export Assets | Download asset bundle for backup | P2 |

**Why Project-Scoped?**
- "Dante" (6yo detective) shouldn't appear in "Tales from Folktales"
- Each show has unique visual style, characters, locations
- Voice profiles are tied to specific characters
- Prevents accidental misuse across shows
- Cleaner mental model for creators

**Import from Project Feature:** If a creator wants to reuse an asset (e.g., same voice actor style), they can explicitly import/copy it to the new project.

**Character Manager Detail:**

| Field | Type | Description |
|-------|------|-------------|
| Name | String | Character name (e.g., "Dante") |
| Description | Text | Personality, backstory |
| Reference Images | Image[] | 4+ reference images for consistency |
| Kling Element Prompt | Text | Copy-paste ready prompt |
| Voice Profile | Reference | Link to voice configuration |
| Physical Attributes | JSON | Age, height, hair, eyes, skin, outfit |
| Signature Poses | Image[] | Standard poses for reference |
| Relationships | Reference[] | Links to related characters |

#### Module 3: Story Studio

| Feature | Description | Priority |
|---------|-------------|----------|
| Story Ideation | AI-assisted brainstorming | P0 |
| Story Generator | Full story generation from premise | P0 |
| Screenplay Converter | Story → Screenplay with dialogue | P0 |
| Scene Breakdown | Screenplay → Individual scenes | P0 |
| Shot List Generator | Scenes → Shot-by-shot breakdown | P0 |
| Continuity Checker | Ensure no story repetition across episodes | P1 |
| Theme Enforcer | Validate story matches show theme | P1 |
| Story Templates | Genre-specific story structures | P1 |

**Story Generation Pipeline:**

```
[Premise/Theme] 
    ↓ (AI: Story Generator)
[Full Story Draft]
    ↓ (AI: Screenplay Converter)
[Screenplay with Dialogue]
    ↓ (AI: Scene Breakdown)
[Scene List with Descriptions]
    ↓ (AI: Shot List Generator)
[Shot-by-Shot with Prompts]
    ↓ (Human Review/Edit)
[Approved Storyboard]
```

#### Module 4: Visual Studio

| Feature | Description | Priority |
|---------|-------------|----------|
| Storyboard Editor | Visual sequence of shots | P0 |
| Image Generation | Text/Image → Still image | P0 |
| Video Generation | Image + Prompt → Video clip | P0 |
| Model Selector | Choose generation API | P0 |
| Element Manager | Configure reference images for consistency | P0 |
| Batch Generation | Queue multiple shots | P0 |
| Upscaling | Enhance resolution | P1 |
| Regeneration | Retry failed/poor generations | P0 |
| Style Transfer | Apply consistent style across shots | P2 |

**Video Generation Settings:**

| Setting | Options | Default |
|---------|---------|---------|
| Model | Kling 2.5 Turbo, Kling Pro, Runway Gen-4, Hailuo, Veo 3 | Kling 2.5 Turbo |
| Duration | 5s, 10s | 10s |
| Mode | Standard (720p), Professional (1080p) | Standard |
| Aspect Ratio | 16:9, 9:16, 1:1 | 16:9 |
| Camera Movement | Static, Pan L/R, Zoom In/Out, Track, Dolly | Static |
| Elements | Up to 4 reference images | - |

#### Module 5: Audio Studio

| Feature | Description | Priority |
|---------|-------------|----------|
| Voice Generation | Text → Character voice | P0 |
| Voice Cloning | Create custom voices | P1 |
| Music Generation | Prompt → Background music | P0 |
| SFX Library | Searchable sound effects | P0 |
| SFX Generation | AI-generated sound effects | P1 |
| Audio Preview | Listen before committing | P0 |
| Lip Sync | Align video to audio | P1 |
| Multi-Language Dubbing | Translate and dub | P2 |

**Voice Generation Settings:**

| Setting | Options | Default |
|---------|---------|---------|
| Voice Provider | ElevenLabs, PlayHT, Azure | ElevenLabs |
| Voice ID | Library of voices | - |
| Stability | 0-100% | 50% |
| Similarity | 0-100% | 75% |
| Style | Narrative, Conversational, Dramatic | Conversational |
| Speed | 0.5x - 2x | 1x |

#### Module 6: Edit Suite

| Feature | Description | Priority |
|---------|-------------|----------|
| Timeline Editor | Multi-track video/audio editing | P0 |
| Auto-Stitch | Automatically join generated clips | P0 |
| Clip Trimming | Cut start/end of clips | P0 |
| Transition Library | Fade, cut, dissolve, etc. | P1 |
| Audio Layering | Multiple audio tracks | P0 |
| Text Overlays | Titles, subtitles, captions | P0 |
| Auto-Captions | AI-generated subtitles | P1 |
| Preview | Real-time playback | P0 |
| Export | Render final video | P0 |
| Shorts Clipper | Extract vertical clips for shorts | P0 |

**Timeline Structure:**

```
┌────────────────────────────────────────────────────────┐
│ TIMELINE                                     [00:05:00]│
├────────────────────────────────────────────────────────┤
│ V1 │ [Shot1] [Shot2] [Shot3] [Shot4] [Shot5] ...      │
├────────────────────────────────────────────────────────┤
│ A1 │ [Voice Track ──────────────────────────]         │
├────────────────────────────────────────────────────────┤
│ A2 │ [Music Track ──────────────────────────]         │
├────────────────────────────────────────────────────────┤
│ A3 │ [SFX] [SFX]    [SFX]        [SFX] [SFX]          │
├────────────────────────────────────────────────────────┤
│ T1 │ [Title]              [Lower Third]    [End Card] │
└────────────────────────────────────────────────────────┘
```

#### Module 7: Publish Hub

| Feature | Description | Priority |
|---------|-------------|----------|
| Platform Connections | OAuth to social platforms | P0 |
| Multi-Platform Publish | Post to multiple platforms at once | P0 |
| Scheduling | Set publish date/time | P0 |
| Metadata Editor | Title, description, tags per platform | P0 |
| Thumbnail Generator | AI-generated thumbnails | P1 |
| Shorts Auto-Clip | Auto-extract best moments for shorts | P1 |
| Cross-Post Manager | Track where content is published | P0 |
| Bulk Scheduling | Schedule multiple episodes | P1 |

**Supported Platforms:**

| Platform | Content Types | API Status |
|----------|---------------|------------|
| YouTube | Long-form, Shorts | ✅ Official API |
| Instagram | Reels, Feed, Stories | ✅ Official API |
| TikTok | Videos | ✅ Official API |
| Facebook | Videos, Reels | ✅ Official API |
| Twitter/X | Videos | ✅ Official API |
| LinkedIn | Videos | ✅ Official API |
| Pinterest | Video Pins | ✅ Official API |
| Snapchat | Spotlight | ⚠️ Limited API |
| Threads | Videos | ⚠️ Limited API |
| Rumble | Videos | ⚠️ Manual/Unofficial |

#### Module 8: Analytics Dashboard

| Feature | Description | Priority |
|---------|-------------|----------|
| Cross-Platform Metrics | Unified view of all platform data | P0 |
| Episode Performance | Per-episode analytics | P0 |
| Series Aggregation | Roll-up stats at project level | P0 |
| Audience Insights | Demographics, geography | P1 |
| Retention Analysis | Where viewers drop off | P1 |
| Revenue Tracking | Ad revenue, memberships | P2 |
| Competitor Analysis | Compare to similar channels | P2 |
| AI Insights | Automated recommendations | P1 |
| Export Reports | PDF/CSV reports | P1 |

**Metrics Tracked:**

| Metric | Platforms | Aggregation |
|--------|-----------|-------------|
| Views | All | Sum |
| Watch Time | YT, FB | Sum |
| Likes | All | Sum |
| Comments | All | Sum |
| Shares | All | Sum |
| Subscribers/Followers Gained | All | Sum |
| Retention Rate | YT, FB | Weighted Avg |
| CTR (Click-Through Rate) | YT | Avg |
| Engagement Rate | All | Calculated |
| Revenue | YT, FB | Sum |

---

## 6. Detailed User Flows

### 6.1 Flow A: Complete Episode Creation (AI-Generated)

**User:** Alex (Solo Creator)  
**Goal:** Create Episode 1 of "Little Detective Dante"  
**Time:** ~3-4 hours

```
┌─────────────────────────────────────────────────────────────────┐
│                    EPISODE CREATION FLOW                         │
└─────────────────────────────────────────────────────────────────┘

PHASE 1: SETUP (15 min)
━━━━━━━━━━━━━━━━━━━━━━
[1.1] User clicks "New Project"
      └→ Selects "Series/Show"
      └→ Names project "Little Detective Dante"
      └→ Configures: 5-min episodes, 16:9, Cartoon style, G-rated

[1.2] User opens Project → "Assets" tab
      └→ Creates Character: "Dante"
         └→ Uploads 4 reference images
         └→ Fills physical attributes
         └→ Generates Kling Element prompt
      └→ Creates Character: "Cece" (repeat)
      └→ Creates Locations: Bedroom, Kitchen, Backyard
      └→ All assets scoped to THIS project only

[1.3] User navigates to "Episodes" tab
      └→ Creates "Season 1"
      └→ Creates "Episode 1: The Case of the Missing Fruit"

PHASE 2: STORY (30 min)
━━━━━━━━━━━━━━━━━━━━━━
[2.1] User opens Episode → "Story Studio"
      └→ Clicks "Generate Story Idea"
      └→ AI suggests 5 mystery plots
      └→ User selects "Missing fruit mystery"

[2.2] User clicks "Generate Full Story"
      └→ AI creates 500-word story draft
      └→ User reviews, makes minor edits
      └→ Clicks "Approve Story"

[2.3] User clicks "Convert to Screenplay"
      └→ AI generates screenplay with:
         - Scene headings
         - Action descriptions
         - Character dialogue
      └→ User reviews, adjusts dialogue
      └→ Clicks "Approve Screenplay"

[2.4] User clicks "Generate Shot List"
      └→ AI breaks screenplay into 30 shots
      └→ Each shot includes:
         - Duration (5s or 10s)
         - Scene description
         - Camera direction
         - Kling prompt (auto-generated)
         - Required assets
      └→ User reviews, reorders if needed
      └→ Clicks "Approve Storyboard"

PHASE 3: VISUAL GENERATION (90 min)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[3.1] User opens "Visual Studio"
      └→ Sees storyboard grid with 30 empty slots
      └→ Each slot shows: prompt, duration, status

[3.2] User configures generation settings:
      └→ Model: Kling 2.5 Turbo
      └→ Mode: Standard (720p)
      └→ Elements: Dante (Slot 1), Cece (Slot 2)

[3.3] User clicks "Generate All"
      └→ System queues 30 generation jobs
      └→ Progress bar shows completion
      └→ Estimated time: 60-90 min
      └→ User can leave and return

[3.4] User reviews generated clips
      └→ Green checkmark: Approved
      └→ Yellow warning: Needs review
      └→ Red X: Failed, retry needed
      └→ User regenerates ~5-6 failed shots
      └→ All shots approved

PHASE 4: AUDIO GENERATION (30 min)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[4.1] User opens "Audio Studio"
      └→ System shows dialogue lines from screenplay
      └→ Each line tagged with character

[4.2] User assigns voices:
      └→ Dante → "Child_Curious_Male" voice
      └→ Mom → "Adult_Warm_Female" voice
      └→ Narrator (if any) → "Narrator_Friendly" voice

[4.3] User clicks "Generate All Dialogue"
      └→ ElevenLabs generates 12 voice lines
      └→ User previews each
      └→ Regenerates 2 that sound off
      └→ All approved

[4.4] User generates music:
      └→ Clicks "Generate Music"
      └→ Prompt: "Playful detective theme, child-friendly, curious"
      └→ AI generates 3 options
      └→ User selects favorite

[4.5] User adds SFX:
      └→ Searches library: "alarm clock," "door creak," "cat meow"
      └→ Adds SFX to relevant shots
      └→ Can generate custom SFX if needed

PHASE 5: EDITING (30 min)
━━━━━━━━━━━━━━━━━━━━━━━━
[5.1] User opens "Edit Suite"
      └→ Timeline pre-populated with:
         - Video track: 30 clips in sequence
         - Audio track: Dialogue placed at correct times
         - Music track: Background music
         - SFX track: Sound effects

[5.2] User clicks "Auto-Stitch"
      └→ System joins clips with default transitions
      └→ Total runtime: 5:02

[5.3] User makes adjustments:
      └→ Trims Shot 15 by 2 seconds
      └→ Adjusts music volume during dialogue
      └→ Adds title card at start
      └→ Adds end card with subscribe CTA

[5.4] User clicks "Preview"
      └→ Watches full episode
      └→ Makes final tweaks
      └→ Clicks "Export"
      └→ System renders final video (5 min)

PHASE 6: PUBLISHING (15 min)
━━━━━━━━━━━━━━━━━━━━━━━━━━━
[6.1] User opens "Publish Hub"
      └→ Selects platforms: YouTube, Facebook, Instagram
      └→ System shows metadata form

[6.2] User fills metadata:
      └→ Title: "Detective Dante: The Missing Fruit Mystery! 🔍🍎"
      └→ Description: [Auto-generated, user edits]
      └→ Tags: [Auto-suggested]
      └→ Thumbnail: [AI-generated options]

[6.3] User configures per-platform:
      └→ YouTube: Full episode (5 min)
      └→ Instagram: Same video
      └→ Facebook: Same video

[6.4] User schedules:
      └→ Publish date: Tomorrow 9 AM
      └→ Clicks "Schedule"

[6.5] User opens "Shorts Clipper"
      └→ AI suggests 3 best moments for shorts
      └→ User approves 2 clips
      └→ Schedules for TikTok, YT Shorts, IG Reels

PHASE 7: MONITORING (Ongoing)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[7.1] Episode publishes automatically

[7.2] User checks Analytics Dashboard
      └→ Views real-time stats
      └→ Sees cross-platform comparison
      └→ Gets AI insights: "Episode performed 20% better than average"

[7.3] User reviews for next episode
      └→ Notes what worked
      └→ Starts Episode 2
```

### 6.2 Flow B: Upload-Only User (Traditional Creator)

**User:** Maria (Traditional Creator)  
**Goal:** Publish her pre-recorded cooking video across platforms  
**Time:** ~15 minutes

```
┌─────────────────────────────────────────────────────────────────┐
│                    UPLOAD-ONLY FLOW                              │
└─────────────────────────────────────────────────────────────────┘

[1] User clicks "New Project"
    └→ Selects "Upload-Only Mode"
    └→ Names project "Maria's Kitchen"

[2] User opens Episode
    └→ Clicks "Upload Video"
    └→ Drags 10-minute cooking video

[3] System processes video:
    └→ Generates auto-captions
    └→ Suggests thumbnail frames
    └→ Suggests shorts clips (best moments)

[4] User opens "Publish Hub"
    └→ Fills metadata once
    └→ AI adapts for each platform
    └→ Selects platforms
    └→ Schedules publish

[5] User approves 2 shorts clips
    └→ Schedules for vertical platforms

[6] Video publishes
    └→ Analytics flow into dashboard
    └→ User sees unified metrics
```

### 6.3 Flow C: Batch Episode Production (Studio)

**User:** Studio Spark (Team)  
**Goal:** Produce 5 episodes in one session  
**Time:** ~1 day (parallelized)

```
┌─────────────────────────────────────────────────────────────────┐
│                    BATCH PRODUCTION FLOW                         │
└─────────────────────────────────────────────────────────────────┘

[1] Producer creates Episode batch:
    └→ Episodes 5-9 of "Little Detective Dante"
    └→ Uses "Batch Story Generator"
    └→ AI generates 5 unique stories (non-repeating)
    └→ Producer approves all stories

[2] System parallelizes:
    └→ All 5 screenplays generated simultaneously
    └→ All 5 shot lists generated
    └→ Total: 150 shots queued

[3] Generation runs overnight:
    └→ API calls distributed across hours
    └→ Cost optimization applied
    └→ Team receives notification when complete

[4] Next morning:
    └→ Editor reviews 150 clips
    └→ Bulk approves 140
    └→ Regenerates 10 failures
    └→ Audio generated in parallel

[5] Editor assembles:
    └→ Uses "Batch Auto-Stitch"
    └→ 5 episodes assembled with one click
    └→ Fine-tunes each (~10 min per episode)

[6] Publisher schedules:
    └→ Episode 5: Monday 9 AM
    └→ Episode 6: Tuesday 9 AM
    └→ Episode 7: Wednesday 9 AM
    └→ (etc.)
    └→ Shorts auto-extracted and scheduled
```

---

## 7. Screen-by-Screen Specification

### 7.1 Global Navigation

```
┌─────────────────────────────────────────────────────────────────┐
│ [Logo]  Dashboard │ Projects │ Shared │ Publish │ Analytics │ ⚙️│
└─────────────────────────────────────────────────────────────────┘
```

| Menu Item | Destination | Description |
|-----------|-------------|-------------|
| Dashboard | `/dashboard` | Overview of all activity |
| Projects | `/projects` | List of all projects |
| Shared | `/shared` | Organization-level SFX, music templates |
| Publish | `/publish` | Publishing queue and history |
| Analytics | `/analytics` | Cross-project analytics |
| Settings (⚙️) | `/settings` | Account, billing, API keys |

**Note:** Asset Library is accessed within each project, not globally. Characters, locations, and voices are project-specific.

### 7.2 Screen Specifications

#### Screen 1: Dashboard (`/dashboard`)

**Purpose:** At-a-glance overview of creator's activity and performance

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ DASHBOARD                                      [+ New Project]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ Total Views     │  │ New Subscribers │  │ Revenue (Est.)  │ │
│  │ 1.2M ↑12%       │  │ 45K ↑8%         │  │ $3,200 ↑15%     │ │
│  │ Last 30 days    │  │ Last 30 days    │  │ Last 30 days    │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                 │
│  RECENT PROJECTS                                    [View All →]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Thumb] Little Detective Dante    │ 12 episodes │ Active   ││
│  │ [Thumb] Tales from Folktales      │ 8 episodes  │ Active   ││
│  │ [Thumb] Baby Engineer Dario       │ 3 episodes  │ Draft    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  PUBLISHING QUEUE                                   [View All →]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Dante Ep 13 │ YouTube │ Scheduled │ Tomorrow 9:00 AM       ││
│  │ Dante Short │ TikTok  │ Scheduled │ Tomorrow 12:00 PM      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  GENERATION STATUS                                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🟢 12/15 shots complete │ Dante Ep 14 │ ETA: 25 min        ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  QUICK ACTIONS                                                  │
│  [+ New Episode] [📤 Quick Upload] [📊 View Analytics]         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Components:**

| Component | Data Source | Interactions |
|-----------|-------------|--------------|
| Metric Cards | Analytics aggregation | Click → Detailed analytics |
| Recent Projects | Project list (sorted by activity) | Click → Project dashboard |
| Publishing Queue | Scheduled posts | Click → Publish hub |
| Generation Status | Active jobs | Click → Visual studio |
| Quick Actions | Static | Opens respective flows |

---

#### Screen 2: Projects List (`/projects`)

**Purpose:** Manage all projects

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ MY PROJECTS                                    [+ New Project]  │
├─────────────────────────────────────────────────────────────────┤
│ [🔍 Search] [Filter: All ▼] [Sort: Recent ▼]    [Grid│List]    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐    │
│  │ [Thumbnail]    │  │ [Thumbnail]    │  │ [Thumbnail]    │    │
│  │                │  │                │  │                │    │
│  │ Little Det...  │  │ Tales from...  │  │ Baby Engineer  │    │
│  │ Series │ 12 ep │  │ Series │ 8 ep  │  │ Series │ 3 ep  │    │
│  │ 850K views     │  │ 420K views     │  │ Draft          │    │
│  │ [Open] [•••]   │  │ [Open] [•••]   │  │ [Open] [•••]   │    │
│  └────────────────┘  └────────────────┘  └────────────────┘    │
│                                                                 │
│  ┌────────────────┐  ┌────────────────┐                        │
│  │      [+]       │  │ [Thumbnail]    │                        │
│  │                │  │                │                        │
│  │  New Project   │  │ Maria's Kit... │                        │
│  │                │  │ Upload │ 24 ep │                        │
│  │                │  │ 1.2M views     │                        │
│  │                │  │ [Open] [•••]   │                        │
│  └────────────────┘  └────────────────┘                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Actions:**

| Action | Trigger | Result |
|--------|---------|--------|
| New Project | Click "+" | Opens creation wizard |
| Open Project | Click card | Opens project dashboard |
| Context Menu (•••) | Click | Duplicate, Archive, Delete, Settings |
| Search | Type in search | Filters projects |
| Filter | Dropdown | Filter by type, status |
| Sort | Dropdown | Sort by date, name, views |

---

#### Screen 3: Project Dashboard (`/projects/:id`)

**Purpose:** Central hub for a specific project (including its Asset Library)

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back │ LITTLE DETECTIVE DANTE              [Settings] [Share]│
├─────────────────────────────────────────────────────────────────┤
│ [Overview] [Episodes] [Assets] [Analytics] [Settings]          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PROJECT STATS                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Episodes │  │ Views    │  │ Subs     │  │ Revenue  │       │
│  │ 12       │  │ 850K     │  │ +12K     │  │ $1,450   │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
│                                                                 │
│  ASSET SUMMARY                                   [Manage Assets]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 👤 4 Characters │ 🏠 6 Locations │ 🎤 3 Voices │ 🎵 5 Music ││
│  │ [Dante] [Cece] [Mom] [+1 more]                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  SEASONS                                         [+ New Season] │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ▼ Season 1 (12 episodes)                                    ││
│  │   ├─ Ep 1: The Missing Fruit      │ ✅ Published │ 125K    ││
│  │   ├─ Ep 2: The Lost Teddy Bear    │ ✅ Published │ 98K     ││
│  │   ├─ Ep 3: The Garden Mystery     │ ✅ Published │ 112K    ││
│  │   ├─ ...                                                    ││
│  │   └─ Ep 12: The Birthday Surprise │ 📅 Scheduled │ --      ││
│  │                                              [+ New Episode]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  RECENT ACTIVITY                                                │
│  • Episode 12 scheduled for Dec 5, 9:00 AM                     │
│  • Episode 11 published - 45K views in 24h                     │
│  • New subscriber milestone: 50K reached!                       │
│                                                                 │
│  QUICK ACTIONS                                                  │
│  [+ New Episode] [+ New Character] [📊 Full Analytics]         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tabs:**
- **Overview:** Project stats, asset summary, seasons list (shown above)
- **Episodes:** Full episode list with filters and bulk actions
- **Assets:** Full Asset Library for this project (Screen 5)
- **Analytics:** Project-specific analytics
- **Settings:** Project configuration, team access, danger zone

---

#### Screen 4: Episode Workspace (`/projects/:id/episodes/:epId`)

**Purpose:** Full episode creation environment

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back │ Episode 1: The Missing Fruit          [Preview] [Save]│
├─────────────────────────────────────────────────────────────────┤
│ [Story] [Visual] [Audio] [Edit] [Publish]         Status: Draft│
├─────────────────────────────────────────────────────────────────┤
```

**Tab: Story**

```
├─────────────────────────────────────────────────────────────────┤
│                         STORY STUDIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  STAGE: [Idea] → [Story] → [Screenplay] → [Shot List] → ✓     │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ STORY DRAFT                                    [Regenerate] ││
│  │                                                             ││
│  │ Dante wakes up to discover all the fruit has vanished      ││
│  │ from the kitchen! With Cece's help, he follows a trail     ││
│  │ of clues to the garden shed, where he discovers a hungry   ││
│  │ squirrel has been stockpiling food...                      ││
│  │                                                             ││
│  │ [Edit] [Approve & Continue →]                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  AI ASSISTANT                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 💡 This story hasn't been used before ✓                    ││
│  │ 💡 Theme matches show guidelines ✓                         ││
│  │ 💡 Age-appropriate content ✓                               ││
│  │ ⚠️ Consider adding educational element about sharing       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab: Visual**

```
├─────────────────────────────────────────────────────────────────┤
│                        VISUAL STUDIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  GENERATION SETTINGS                                            │
│  Model: [Kling 2.5 Turbo ▼]  Mode: [Standard ▼]  [⚙️ Advanced] │
│                                                                 │
│  ELEMENTS (Reference Images)                                    │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                   │
│  │ Dante  │ │ Cece   │ │Bedroom │ │ [+Add] │                   │
│  │ [img]  │ │ [img]  │ │ [img]  │ │        │                   │
│  └────────┘ └────────┘ └────────┘ └────────┘                   │
│                                                                 │
│  STORYBOARD                              [Generate All] [Export]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Shot 1 │ Shot 2 │ Shot 3 │ Shot 4 │ Shot 5 │ Shot 6 │ ... ││
│  │ [vid]  │ [vid]  │ [🔄]   │ [⏳]   │ [⏳]   │ [⏳]   │     ││
│  │ 10s ✅ │ 5s ✅  │ 10s 🔄 │ 10s -- │ 5s --  │ 10s -- │     ││
│  │ [Play] │ [Play] │ [Retry]│ [Queue]│ [Queue]│ [Queue]│     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  SELECTED SHOT: Shot 1                                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Video Preview]              │ PROMPT                       ││
│  │                              │ Wide shot of cozy child's    ││
│  │     [▶️ Play]                │ bedroom, warm yellow walls,  ││
│  │                              │ 6 year old boy with curly... ││
│  │ Duration: 10s │ Status: ✅   │                              ││
│  │                              │ [Edit Prompt] [Regenerate]   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  PROGRESS: 2/30 shots complete │ Est. remaining: 45 min        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab: Audio**

```
├─────────────────────────────────────────────────────────────────┤
│                         AUDIO STUDIO                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  DIALOGUE                                        [Generate All] │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ # │ Character │ Line                        │ Voice │ Status││
│  │ 1 │ Dante     │ "A mystery! This calls..." │ [▼]   │ ✅    ││
│  │ 2 │ Dante     │ "Hmm, a banana peel..."    │ [▼]   │ ✅    ││
│  │ 3 │ Mom       │ "Dante, the strangest..."  │ [▼]   │ ⏳    ││
│  │ ...                                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  MUSIC                                                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [🎵 Playful Detective Theme]     │ 5:02 │ ✅ │ [Replace]   ││
│  │ Prompt: "Playful detective theme, child-friendly..."       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  SOUND EFFECTS                                   [+ Add SFX]    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Shot 2  │ Alarm clock ringing    │ 🔊 │ [Remove]           ││
│  │ Shot 3  │ Yawning sound          │ 🔊 │ [Remove]           ││
│  │ Shot 10 │ Cat meowing            │ 🔊 │ [Remove]           ││
│  │ Shot 19 │ Door creaking          │ 🔊 │ [Remove]           ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab: Edit**

```
├─────────────────────────────────────────────────────────────────┤
│                          EDIT SUITE                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                                                             ││
│  │                    [VIDEO PREVIEW]                          ││
│  │                                                             ││
│  │              [⏮️] [▶️ Play] [⏭️]  00:02:34 / 05:02         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  TIMELINE                                            [+ Track]  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 00:00    01:00    02:00    03:00    04:00    05:00         ││
│  │ V1 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ Video   ││
│  │ A1 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ Voice   ││
│  │ A2 │▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│ Music   ││
│  │ A3 │▓▓  ▓▓    ▓▓        ▓▓    ▓▓      ▓▓  ▓▓   │ SFX     ││
│  │ T1 │▓▓▓                                    ▓▓▓▓│ Text    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  TOOLS                                                          │
│  [✂️ Cut] [🔗 Join] [🔊 Volume] [📝 Text] [🎬 Transition]      │
│                                                                 │
│  [Auto-Stitch All] [Add Title Card] [Add End Card] [Export]    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Tab: Publish**

```
├─────────────────────────────────────────────────────────────────┤
│                         PUBLISH HUB                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  FULL EPISODE                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ PLATFORMS                                                   ││
│  │ [✓] YouTube  [✓] Facebook  [✓] Instagram  [ ] Twitter      ││
│  │                                                             ││
│  │ METADATA                                                    ││
│  │ Title: [Detective Dante: The Missing Fruit Mystery! 🔍🍎 ] ││
│  │ Description: [Auto-generated... Edit]                       ││
│  │ Tags: [detective, kids, cartoon, mystery, dante...]         ││
│  │                                                             ││
│  │ THUMBNAIL                                                   ││
│  │ [Thumb1] [Thumb2] [Thumb3] [+ Upload Custom]               ││
│  │                                                             ││
│  │ SCHEDULE                                                    ││
│  │ [○ Publish Now] [● Schedule] Date: [Dec 5] Time: [9:00 AM] ││
│  │                                                             ││
│  │ [Schedule Publish]                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  SHORTS (Auto-Extracted)                         [+ Manual Clip]│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [Preview] │ "Dante finds the clue!" │ 0:45 │ TikTok, YT    ││
│  │ [Preview] │ "The squirrel reveal!"  │ 0:30 │ IG Reels      ││
│  │           │ [✓ Include] [✓ Include] │                      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Screen 5: Project Asset Library (`/projects/:id/assets`)

**Purpose:** Manage all assets for a specific project

**Access:** Via Project Dashboard → "Assets" tab OR Project navigation

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Back │ LITTLE DETECTIVE DANTE › ASSET LIBRARY    [+ Upload]   │
├─────────────────────────────────────────────────────────────────┤
│ [Overview] [Episodes] [Assets ●] [Analytics] [Settings]        │
├─────────────────────────────────────────────────────────────────┤
│ [All] [Characters] [Locations] [Props] [Music] [Voices] [SFX]  │
├─────────────────────────────────────────────────────────────────┤
│ [🔍 Search assets...]                      [Grid│List] [Sort ▼]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CHARACTERS                                  [+ New Character]  │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ [Image]    │ │ [Image]    │ │ [Image]    │ │ [Image]    │   │
│  │ Dante      │ │ Cece       │ │ Mom        │ │ Squirrel   │   │
│  │ 12 episodes│ │ 12 episodes│ │ 8 episodes │ │ 1 episode  │   │
│  │ [Edit]     │ │ [Edit]     │ │ [Edit]     │ │ [Edit]     │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│                                                                 │
│  LOCATIONS                                   [+ New Location]   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐   │
│  │ [Image]    │ │ [Image]    │ │ [Image]    │ │ [Image]    │   │
│  │ Bedroom    │ │ Kitchen    │ │ Backyard   │ │ Street     │   │
│  │ 8 episodes │ │ 10 episodes│ │ 12 episodes│ │ 3 episodes │   │
│  │ [Edit]     │ │ [Edit]     │ │ [Edit]     │ │ [Edit]     │   │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘   │
│                                                                 │
│  VOICE PROFILES                              [+ New Voice]      │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🎤 Dante Voice │ Child, curious, friendly │ [▶️ Sample]    ││
│  │ 🎤 Mom Voice   │ Adult, warm, caring      │ [▶️ Sample]    ││
│  │ 🎤 Narrator    │ Friendly, engaging       │ [▶️ Sample]    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│  [Import from Another Project] [Import from Shared Library]    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key Differences from Global Library:**
- URL includes project ID (`/projects/:id/assets`)
- Breadcrumb shows project name
- Assets shown are ONLY for this project
- "Import from Another Project" allows copying (not linking)
- "Import from Shared Library" pulls generic SFX/music

---

#### Screen 5b: Shared Resources (`/shared`)

**Purpose:** Organization-level generic resources (SFX, music templates)

**Access:** Global nav → "Shared"

```
┌─────────────────────────────────────────────────────────────────┐
│ SHARED RESOURCES                                   [+ Upload]   │
├─────────────────────────────────────────────────────────────────┤
│ [All] [Sound Effects] [Music Templates] [Style Presets]        │
├─────────────────────────────────────────────────────────────────┤
│ [🔍 Search...]                              [Grid│List] [Sort ▼]│
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SOUND EFFECTS                               [+ Upload SFX]     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔊 Door Creak        │ 2.1s │ [▶️] │ [Add to Project ▼]    ││
│  │ 🔊 Footsteps Wood    │ 3.5s │ [▶️] │ [Add to Project ▼]    ││
│  │ 🔊 Wind Ambience     │ 10s  │ [▶️] │ [Add to Project ▼]    ││
│  │ 🔊 Cat Meow          │ 1.2s │ [▶️] │ [Add to Project ▼]    ││
│  │ 🔊 Bird Chirping     │ 5.0s │ [▶️] │ [Add to Project ▼]    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  MUSIC TEMPLATES (Royalty-Free)              [+ Upload Music]   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🎵 Happy Ukulele     │ 2:30 │ [▶️] │ [Add to Project ▼]    ││
│  │ 🎵 Suspense Strings  │ 3:00 │ [▶️] │ [Add to Project ▼]    ││
│  │ 🎵 Adventure Theme   │ 2:45 │ [▶️] │ [Add to Project ▼]    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  PLATFORM-PROVIDED (Free for all users)                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔊 Basic SFX Pack (50 sounds)           │ [Browse]          ││
│  │ 🎵 Kids Content Music Pack (20 tracks)  │ [Browse]          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Purpose of Shared Resources:**
- Generic sounds usable across ANY project (door sounds, footsteps, ambience)
- Royalty-free music templates
- Platform-provided asset packs
- NOT for characters, locations, or project-specific items

---

#### Screen 6: Analytics Dashboard (`/analytics`)

```
┌─────────────────────────────────────────────────────────────────┐
│ ANALYTICS                                   [Export] [Settings] │
├─────────────────────────────────────────────────────────────────┤
│ Project: [All Projects ▼]  Period: [Last 30 Days ▼]            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  OVERVIEW                                                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐ │
│  │ Total Views  │ │ Watch Hours │ │ Subscribers  │ │ Revenue│ │
│  │ 1.2M        │ │ 45.2K       │ │ +12.4K       │ │ $3,240 │ │
│  │ ↑ 12%       │ │ ↑ 8%        │ │ ↑ 15%        │ │ ↑ 22%  │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘ │
│                                                                 │
│  VIEWS OVER TIME                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │     📈 [Line chart showing views over 30 days]              ││
│  │                                                             ││
│  │     Legend: [—YouTube] [—Facebook] [—Instagram] [—TikTok]  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  TOP PERFORMING CONTENT                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ #  │ Title                           │ Views │ Eng. │ CTR  ││
│  │ 1  │ Dante Ep 8: The Park Mystery    │ 125K  │ 8.2% │ 4.5% ││
│  │ 2  │ Dante Ep 5: The Lost Puppy      │ 112K  │ 7.8% │ 4.2% ││
│  │ 3  │ Dante Short: Squirrel Reveal    │ 98K   │ 12%  │ --   ││
│  │ 4  │ Dante Ep 11: The Cookie Thief   │ 87K   │ 7.1% │ 3.8% ││
│  │ 5  │ Tales Ep 3: The Clever Fox      │ 76K   │ 6.9% │ 3.5% ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  PLATFORM BREAKDOWN                                             │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Platform  │ Views │ Watch Time │ Subs │ Revenue │ Top Type ││
│  │ YouTube   │ 650K  │ 32K hrs    │ +8K  │ $2,800  │ Long     ││
│  │ TikTok    │ 320K  │ --         │ +15K │ --      │ Shorts   ││
│  │ Instagram │ 180K  │ --         │ +5K  │ --      │ Reels    ││
│  │ Facebook  │ 50K   │ 2.1K hrs   │ +1K  │ $440    │ Long     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  AI INSIGHTS                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 💡 Your mystery episodes outperform other themes by 23%    ││
│  │ 💡 Videos posted at 9 AM get 15% more views               ││
│  │ 💡 Episodes with animals have 30% higher retention         ││
│  │ 💡 Your TikTok shorts are driving YouTube subscriptions    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

#### Screen 7: Settings (`/settings`)

```
┌─────────────────────────────────────────────────────────────────┐
│ SETTINGS                                                        │
├─────────────────────────────────────────────────────────────────┤
│ [Account] [Billing] [API Keys] [Integrations] [Team] [Defaults]│
├─────────────────────────────────────────────────────────────────┤

TAB: API Keys
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  VIDEO GENERATION                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Provider      │ Status    │ Credits/Balance │ Actions      ││
│  │ Kling (PiAPI) │ 🟢 Active │ 45,000 credits  │ [Manage]     ││
│  │ Runway        │ ⚪ Not Set│ --              │ [Connect]    ││
│  │ Hailuo        │ ⚪ Not Set│ --              │ [Connect]    ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  AUDIO GENERATION                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ElevenLabs    │ 🟢 Active │ 120K characters │ [Manage]     ││
│  │ Suno AI       │ 🟢 Active │ 500 credits     │ [Manage]     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  PUBLISHING                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ YouTube       │ 🟢 Connected │ @DetectiveDante │ [Manage]  ││
│  │ TikTok        │ 🟢 Connected │ @detectivedante │ [Manage]  ││
│  │ Instagram     │ 🟢 Connected │ @detective.dante│ [Manage]  ││
│  │ Facebook      │ 🟡 Expiring  │ Dante Page      │ [Refresh] ││
│  │ Twitter/X     │ ⚪ Not Set   │ --              │ [Connect] ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  LLM (Story Generation)                                         │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Provider: [Claude ▼]                                        ││
│  │ API Key:  [••••••••••••••••] [Show] [Test]                 ││
│  │ Model:    [claude-sonnet-4-20250514 ▼]                             ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

TAB: Billing
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  CURRENT PLAN                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Plan: Creator Pro │ $49/month │ Next billing: Jan 1, 2026  ││
│  │ [Upgrade] [Cancel]                                          ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  USAGE THIS MONTH                                               │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Feature           │ Used     │ Included │ Overage Cost     ││
│  │ Video Minutes     │ 45 min   │ 60 min   │ --               ││
│  │ Voice Characters  │ 85K      │ 100K     │ --               ││
│  │ Music Tracks      │ 12       │ 20       │ --               ││
│  │ Storage           │ 15 GB    │ 50 GB    │ --               ││
│  │ Publishes         │ 38       │ Unlimited│ --               ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  API SPENDING (BYOK - Bring Your Own Key)                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Kling (via PiAPI)  │ $156.00 this month                     ││
│  │ ElevenLabs         │ $22.00 this month                      ││
│  │ Suno AI            │ $10.00 this month                      ││
│  │ Claude API         │ $8.50 this month                       ││
│  │ ─────────────────────────────────────────                   ││
│  │ Total API Spend    │ $196.50 this month                     ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 8. API Integrations & Vendor Analysis

### 8.1 Video Generation APIs

#### Option 1: Kling AI (via PiAPI) - RECOMMENDED

| Attribute | Detail |
|-----------|--------|
| **Provider** | Kuaishou (via PiAPI third-party) |
| **Website** | https://piapi.ai |
| **Models** | Kling 1.0, 1.5, 1.6, 2.0, 2.1, 2.5 Turbo |
| **Max Duration** | 10 seconds per generation |
| **Resolutions** | 720p (Standard), 1080p (Professional) |
| **Character Consistency** | Elements feature (up to 4 reference images) |
| **Strengths** | Best price/quality ratio, excellent for cartoons |

**Pricing (PiAPI Pay-as-you-go):**

| Mode | Duration | Cost per Video |
|------|----------|----------------|
| Standard (720p) | 5 seconds | $0.13-0.16 |
| Standard (720p) | 10 seconds | $0.26-0.32 |
| Professional (1080p) | 5 seconds | $0.35-0.49 |
| Professional (1080p) | 10 seconds | $0.70-0.98 |

**API Endpoint:**

```
POST https://api.piapi.ai/api/kling/v1/video

Headers:
  Authorization: Bearer {API_KEY}
  Content-Type: application/json

Body:
{
  "model": "kling-v2.5-turbo",
  "mode": "standard",
  "duration": "10",
  "prompt": "...",
  "aspect_ratio": "16:9",
  "elements": [
    {"type": "character", "image_url": "..."},
    {"type": "character", "image_url": "..."}
  ]
}

Response:
{
  "task_id": "abc123",
  "status": "processing",
  "estimated_time": 120
}
```

#### Option 2: Runway Gen-4

| Attribute | Detail |
|-----------|--------|
| **Provider** | Runway |
| **Website** | https://runwayml.com |
| **Models** | Gen-4, Gen-4 Turbo |
| **Max Duration** | 10 seconds (extendable) |
| **Resolutions** | Up to 1080p |
| **Strengths** | High quality, good motion |

**Pricing:**

| Plan | Cost | Credits |
|------|------|---------|
| Free | $0 | 125 one-time |
| Standard | $15/mo | 625/mo |
| Pro | $35/mo | 2,250/mo |
| Unlimited | $95/mo | Unlimited relaxed |

**API:** $0.05/second for Gen-4 Turbo

#### Option 3: Hailuo AI (MiniMax)

| Attribute | Detail |
|-----------|--------|
| **Provider** | MiniMax |
| **Website** | https://hailuoai.video |
| **Models** | Hailuo-01, S2V-01 |
| **Max Duration** | 6 seconds |
| **Strengths** | Realistic motion, lower cost |

**Pricing (via fal.ai):**

| Resolution | Cost per Second |
|------------|-----------------|
| 768p | $0.045 |
| 1080p | $0.065 |

#### Option 4: Google Veo 3

| Attribute | Detail |
|-----------|--------|
| **Provider** | Google |
| **Access** | Google AI Studio / Vertex AI |
| **Strengths** | Native audio generation, high quality |
| **Limitations** | US-only initially, expensive |

**Pricing:**

| Access | Cost |
|--------|------|
| AI Ultra Plan | $250/mo (web) |
| API | $0.75/second (with audio) |
| Third-party (Kie.ai) | $0.05/second |

### 8.2 Audio Generation APIs

#### Voice: ElevenLabs

| Attribute | Detail |
|-----------|--------|
| **Website** | https://elevenlabs.io |
| **Features** | TTS, Voice Cloning, Dubbing |
| **Quality** | Industry-leading naturalness |

**Pricing:**

| Plan | Cost | Characters |
|------|------|------------|
| Free | $0 | 10,000/mo |
| Starter | $5/mo | 30,000/mo |
| Creator | $22/mo | 100,000/mo |
| Pro | $99/mo | 500,000/mo |
| Scale | $330/mo | 2,000,000/mo |

**API Endpoint:**

```
POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}

Headers:
  xi-api-key: {API_KEY}
  Content-Type: application/json

Body:
{
  "text": "A mystery! This calls for Detective Dante!",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75
  }
}
```

#### Music: Suno AI

| Attribute | Detail |
|-----------|--------|
| **Website** | https://suno.ai |
| **Features** | Full song generation from prompts |
| **Quality** | High-quality, genre-flexible |

**Pricing:**

| Plan | Cost | Credits |
|------|------|---------|
| Free | $0 | 50 credits/day |
| Pro | $10/mo | 2,500 credits/mo |
| Premier | $30/mo | 10,000 credits/mo |

**API:** Available via unofficial wrappers or official partnership

#### SFX: ElevenLabs Sound Effects

| Feature | Detail |
|---------|--------|
| **Type** | AI-generated sound effects |
| **Input** | Text description |
| **Output** | MP3/WAV audio |
| **Included** | In ElevenLabs plans |

### 8.3 LLM APIs (Story Generation)

#### Option 1: Claude (Anthropic) - RECOMMENDED

| Attribute | Detail |
|-----------|--------|
| **Models** | Claude Sonnet 4, Claude Opus 4 |
| **Strengths** | Creative writing, long context, safety |

**Pricing:**

| Model | Input | Output |
|-------|-------|--------|
| Claude Sonnet 4 | $3/M tokens | $15/M tokens |
| Claude Opus 4 | $15/M tokens | $75/M tokens |

**Estimated cost per episode script:** $0.05-0.15

#### Option 2: OpenAI GPT-4

| Model | Input | Output |
|-------|-------|--------|
| GPT-4o | $2.50/M tokens | $10/M tokens |
| GPT-4 Turbo | $10/M tokens | $30/M tokens |

#### Option 3: Google Gemini

| Model | Input | Output |
|-------|-------|--------|
| Gemini 1.5 Pro | $1.25/M tokens | $5/M tokens |
| Gemini 1.5 Flash | $0.075/M tokens | $0.30/M tokens |

### 8.4 Publishing APIs

#### YouTube Data API v3

| Endpoint | Purpose |
|----------|---------|
| `videos.insert` | Upload video |
| `videos.update` | Update metadata |
| `channels.list` | Get channel info |
| `analytics` | Performance data |

**Quotas:** 10,000 units/day (1 upload = 1,600 units)

**OAuth Scopes:**
- `youtube.upload`
- `youtube.readonly`
- `yt-analytics.readonly`

#### Instagram Graph API

| Endpoint | Purpose |
|----------|---------|
| `POST /{ig-user-id}/media` | Create media container |
| `POST /{ig-user-id}/media_publish` | Publish media |
| `GET /{ig-media-id}/insights` | Get analytics |

**Requirements:**
- Business or Creator account
- Facebook Page linked
- App Review for permissions

#### TikTok Content Posting API

| Endpoint | Purpose |
|----------|---------|
| `POST /v2/post/publish/video/init/` | Initialize upload |
| `POST /v2/post/publish/status/fetch/` | Check status |

**Requirements:**
- TikTok for Developers account
- App approval for posting

#### Facebook Graph API

| Endpoint | Purpose |
|----------|---------|
| `POST /{page-id}/videos` | Upload video |
| `GET /{video-id}/video_insights` | Get analytics |

**Permissions:**
- `pages_manage_posts`
- `pages_read_engagement`
- `read_insights`

### 8.5 API Cost Summary (Per Episode)

| Component | API | Estimated Cost |
|-----------|-----|----------------|
| Story Generation | Claude | $0.10 |
| Video Generation (30 clips) | Kling/PiAPI | $7.00 |
| Voice Generation (12 lines) | ElevenLabs | $0.50 |
| Music Generation (1 track) | Suno | $0.30 |
| SFX | ElevenLabs | $0.10 |
| Publishing | YouTube/TikTok/IG | Free |
| **Total per 5-min episode** | | **~$8.00** |

---

## 9. Pricing & Cost Engine

### 9.1 Platform Pricing Tiers

| Tier | Monthly | Annual | Target User |
|------|---------|--------|-------------|
| **Free** | $0 | $0 | Hobbyists, trial users |
| **Creator** | $29 | $290 | Solo creators |
| **Pro** | $79 | $790 | Active creators |
| **Studio** | $199 | $1,990 | Teams, agencies |
| **Enterprise** | Custom | Custom | Large organizations |

### 9.2 Feature Matrix

| Feature | Free | Creator | Pro | Studio |
|---------|------|---------|-----|--------|
| Projects | 1 | 3 | 10 | Unlimited |
| Episodes/month | 2 | 10 | 30 | 100 |
| Video minutes/month | 10 | 60 | 200 | 500 |
| Voice characters/month | 10K | 100K | 300K | 1M |
| Team members | 1 | 1 | 3 | 10 |
| Storage | 5 GB | 50 GB | 200 GB | 1 TB |
| Publishing platforms | 2 | 5 | All | All |
| Analytics retention | 7 days | 30 days | 90 days | 1 year |
| Priority generation | ❌ | ❌ | ✅ | ✅ |
| API access | ❌ | ❌ | ✅ | ✅ |
| Custom branding | ❌ | ❌ | ❌ | ✅ |
| Dedicated support | ❌ | ❌ | ❌ | ✅ |

### 9.3 BYOK (Bring Your Own Key) Model

Users can connect their own API keys for generation services, paying those providers directly. Platform charges only for orchestration.

| Provider | BYOK Supported | Platform Fee |
|----------|----------------|--------------|
| Kling (PiAPI) | ✅ | 5% markup |
| Runway | ✅ | 5% markup |
| ElevenLabs | ✅ | 5% markup |
| Suno | ✅ | 5% markup |
| Claude/OpenAI | ✅ | 5% markup |

### 9.4 Credit System

For users who prefer bundled pricing:

| Credit Pack | Price | Credits | Per-Credit Cost |
|-------------|-------|---------|-----------------|
| Starter | $10 | 1,000 | $0.010 |
| Value | $50 | 6,000 | $0.0083 |
| Pro | $100 | 15,000 | $0.0067 |
| Bulk | $500 | 100,000 | $0.005 |

**Credit Consumption:**

| Action | Credits |
|--------|---------|
| 10s video (Standard) | 40 credits |
| 10s video (Pro) | 70 credits |
| Voice line (per 100 chars) | 5 credits |
| Music track | 50 credits |
| Story generation | 10 credits |
| Publish (per platform) | 0 credits |

### 9.5 Cost Calculator (Built into UI)

```
┌─────────────────────────────────────────────────────────────────┐
│ COST ESTIMATOR                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Episode Length:     [5 ▼] minutes                             │
│  Video Quality:      [Standard 720p ▼]                         │
│  Episodes per Month: [30]                                       │
│                                                                 │
│  ───────────────────────────────────────────────────────────── │
│                                                                 │
│  ESTIMATED MONTHLY COST                                         │
│                                                                 │
│  Video Generation:    $210.00  (900 clips × $0.23)             │
│  Voice Generation:    $15.00   (360 lines)                     │
│  Music Generation:    $9.00    (30 tracks)                     │
│  Platform Fee:        $79.00   (Pro plan)                      │
│                                                                 │
│  ───────────────────────────────────────────────────────────── │
│  TOTAL:               $313.00/month                            │
│  Per Episode:         $10.43                                   │
│                                                                 │
│  [View Breakdown] [Optimize Costs] [Choose Plan]               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 10. Publishing & Distribution

### 10.1 Supported Platforms

| Platform | Content Types | Auto-Publish | Analytics | Shorts Support |
|----------|---------------|--------------|-----------|----------------|
| YouTube | Long, Shorts | ✅ | ✅ | ✅ |
| TikTok | Short | ✅ | ✅ | N/A |
| Instagram | Reels, Feed | ✅ | ✅ | ✅ |
| Facebook | Long, Reels | ✅ | ✅ | ✅ |
| Twitter/X | Short clips | ✅ | ⚠️ Limited | N/A |
| LinkedIn | Long | ✅ | ⚠️ Limited | N/A |
| Pinterest | Pins | ✅ | ✅ | N/A |
| Snapchat | Spotlight | ⚠️ Manual | ❌ | N/A |
| Rumble | Long | ⚠️ Manual | ❌ | ❌ |

### 10.2 Publishing Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    PUBLISHING PIPELINE                           │
└─────────────────────────────────────────────────────────────────┘

[Final Video]
     │
     ▼
┌─────────────────┐
│ Format Optimizer │ ← Encode per platform specs
└────────┬────────┘
         │
    ┌────┴────┬────────┬────────┬────────┐
    ▼         ▼        ▼        ▼        ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│YouTube│ │TikTok │ │  IG   │ │  FB   │ │  X    │
└───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘
    │         │        │        │        │
    ▼         ▼        ▼        ▼        ▼
[Upload] [Upload] [Upload] [Upload] [Upload]
    │         │        │        │        │
    ▼         ▼        ▼        ▼        ▼
[Metadata] [Metadata] [Metadata] [Metadata] [Metadata]
    │         │        │        │        │
    ▼         ▼        ▼        ▼        ▼
[Schedule/Publish] ─────────────────────────→ [Track Status]
```

### 10.3 Platform-Specific Requirements

#### YouTube

| Requirement | Specification |
|-------------|---------------|
| Max file size | 256 GB |
| Max duration | 12 hours |
| Formats | MP4, MOV, AVI, WMV |
| Recommended resolution | 1080p or 4K |
| Shorts requirements | ≤60s, vertical (9:16) |
| Thumbnail | 1280×720 px |

#### TikTok

| Requirement | Specification |
|-------------|---------------|
| Max file size | 287.6 MB (mobile), 500 MB (web) |
| Max duration | 10 minutes |
| Format | MP4, MOV |
| Aspect ratio | 9:16 preferred |
| Resolution | 1080×1920 |

#### Instagram

| Requirement | Specification |
|-------------|---------------|
| Reels max duration | 90 seconds |
| Feed video max | 60 minutes |
| Format | MP4, MOV |
| Aspect ratio | 9:16 (Reels), 1:1 or 4:5 (Feed) |
| Resolution | 1080×1920 (Reels) |

### 10.4 Shorts Auto-Clipper

**AI-Powered Short Extraction:**

1. **Scene Detection:** Identify high-energy moments
2. **Engagement Prediction:** Score segments by predicted engagement
3. **Auto-Cropping:** Convert 16:9 to 9:16 with subject tracking
4. **Hook Optimization:** Ensure strong opening 3 seconds
5. **CTA Insertion:** Add "Watch full video" overlays

**Configuration:**

| Setting | Options | Default |
|---------|---------|---------|
| Shorts per episode | 1-5 | 2 |
| Duration | 15-60 seconds | 30s |
| Selection criteria | Engagement, action, humor | Engagement |
| Auto-caption | Yes/No | Yes |
| CTA overlay | Yes/No | Yes |

---

## 11. Analytics & Insights

### 11.1 Data Collection

| Source | Data Points | Sync Frequency |
|--------|-------------|----------------|
| YouTube | Views, watch time, CTR, retention, subs, revenue | Every 6 hours |
| TikTok | Views, likes, shares, comments, followers | Every 6 hours |
| Instagram | Reach, impressions, engagement, followers | Every 6 hours |
| Facebook | Views, reach, engagement, followers | Every 6 hours |
| Internal | Generation costs, publish history | Real-time |

### 11.2 Metrics Definitions

| Metric | Definition | Calculation |
|--------|------------|-------------|
| Total Views | Sum of views across platforms | Σ platform views |
| Watch Time | Total hours watched | Σ watch hours |
| Engagement Rate | Interactions / Reach | (likes + comments + shares) / views × 100 |
| CTR | Click-through rate | clicks / impressions × 100 |
| Retention Rate | % viewers watching to end | (end views / start views) × 100 |
| Subscriber Gain | New subscribers from content | Σ new subs |
| Revenue | Estimated earnings | Platform-reported |
| Cost per Episode | Production cost | Generation + platform fees |
| ROI | Return on investment | (Revenue - Cost) / Cost × 100 |

### 11.3 Dashboard Widgets

| Widget | Data Displayed | Interactions |
|--------|----------------|--------------|
| Overview Cards | Views, Watch Time, Subs, Revenue | Click → detailed view |
| Trend Chart | Views over time by platform | Hover → tooltips, Click → filter |
| Top Content | Best performing episodes | Click → episode analytics |
| Platform Breakdown | Per-platform metrics | Click → platform detail |
| AI Insights | Automated recommendations | Dismiss, act, save |
| Retention Graph | Audience retention curve | Hover → timestamp data |
| Geographic Heat Map | Views by country | Click → country detail |
| Demographics | Age, gender breakdown | Filter by segment |

### 11.4 AI-Powered Insights

**Insight Types:**

| Type | Example | Trigger |
|------|---------|---------|
| Performance | "This episode is 30% above your average" | Significant deviation |
| Timing | "Your audience is most active at 9 AM EST" | Pattern detected |
| Content | "Mystery episodes outperform by 23%" | Category comparison |
| Cross-Platform | "TikTok shorts drive YouTube subs" | Cross-platform correlation |
| Optimization | "Thumbnails with faces get 40% higher CTR" | A/B test results |
| Trend | "Your growth rate increased 15% this month" | Trend analysis |

### 11.5 Reporting

| Report Type | Contents | Export Formats |
|-------------|----------|----------------|
| Weekly Summary | KPIs, top content, insights | PDF, Email |
| Monthly Report | Full analytics, trends, recommendations | PDF, CSV |
| Episode Report | Per-episode performance | PDF |
| Revenue Report | Earnings breakdown | CSV, PDF |
| Custom Report | User-selected metrics | CSV, PDF |

---

## 12. Technical Architecture

### 12.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT LAYER                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │ Web App     │  │ Mobile App  │  │ API Clients │             │
│  │ (React/Next)│  │ (Future)    │  │ (Developers)│             │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘             │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API GATEWAY                              │
│              (Authentication, Rate Limiting, Routing)            │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       SERVICE LAYER                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ Project   │ │ Story     │ │ Generation│ │ Audio     │       │
│  │ Service   │ │ Service   │ │ Service   │ │ Service   │       │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ Edit      │ │ Publish   │ │ Analytics │ │ Asset     │       │
│  │ Service   │ │ Service   │ │ Service   │ │ Service   │       │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                      WORKER LAYER                                │
│         (Background Jobs, Queues, Scheduled Tasks)               │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │ Video Gen     │ │ Audio Gen     │ │ Publish       │         │
│  │ Workers       │ │ Workers       │ │ Workers       │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐         │
│  │ Analytics     │ │ Render        │ │ Notification  │         │
│  │ Sync Workers  │ │ Workers       │ │ Workers       │         │
│  └───────────────┘ └───────────────┘ └───────────────┘         │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       DATA LAYER                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐       │
│  │ PostgreSQL│ │ Redis     │ │ S3/Cloud  │ │ Elasticsearch    │
│  │ (Primary) │ │ (Cache)   │ │ Storage   │ │ (Search)  │       │
│  └───────────┘ └───────────┘ └───────────┘ └───────────┘       │
└─────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EXTERNAL SERVICES                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│  │ Kling   │ │ Eleven  │ │ Suno    │ │ Claude  │ │ YouTube │   │
│  │ API     │ │ Labs    │ │ AI      │ │ API     │ │ API     │   │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘ └─────────┘   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐               │
│  │ TikTok  │ │ Insta   │ │ Facebook│ │ Stripe  │               │
│  │ API     │ │ API     │ │ API     │ │ Billing │               │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘               │
└─────────────────────────────────────────────────────────────────┘
```

### 12.2 Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Frontend | Next.js 14+ (React) | SSR, App Router, great DX |
| Styling | Tailwind CSS + shadcn/ui | Rapid development, consistent design |
| State | Zustand + React Query | Simple state, excellent data fetching |
| Backend | Node.js + Express/Fastify | JavaScript ecosystem, async-friendly |
| Database | PostgreSQL | Robust, relational, JSON support |
| Cache | Redis | Fast caching, job queues |
| Queue | BullMQ | Redis-based job processing |
| Storage | AWS S3 / Cloudflare R2 | Scalable media storage |
| CDN | Cloudflare | Global delivery, caching |
| Search | Elasticsearch / Meilisearch | Asset search, analytics queries |
| Auth | Clerk / Auth0 | OAuth, social logins |
| Payments | Stripe | Subscriptions, usage billing |
| Monitoring | Datadog / Sentry | Observability, error tracking |
| CI/CD | GitHub Actions | Automated deployments |
| Hosting | Vercel (Frontend) + AWS/Railway (Backend) | Scalable, managed |

### 12.3 Job Queue Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      JOB QUEUES (BullMQ)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  HIGH PRIORITY                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ video-generation │ Max 10 concurrent │ Timeout: 10min      ││
│  │ audio-generation │ Max 20 concurrent │ Timeout: 2min       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  MEDIUM PRIORITY                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ video-render     │ Max 5 concurrent  │ Timeout: 30min      ││
│  │ publish          │ Max 10 concurrent │ Timeout: 5min       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  LOW PRIORITY                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ analytics-sync   │ Max 50 concurrent │ Timeout: 1min       ││
│  │ notifications    │ Max 100 concurrent│ Timeout: 30sec      ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. Database Schema

### 13.1 Core Entities

```sql
-- Organizations (Workspaces)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  plan VARCHAR(50) DEFAULT 'free',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  avatar_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Organization Members
CREATE TABLE organization_members (
  organization_id UUID REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  role VARCHAR(50) DEFAULT 'member',
  PRIMARY KEY (organization_id, user_id)
);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  type VARCHAR(50) NOT NULL, -- 'series', 'film', 'shorts', 'upload_only'
  description TEXT,
  thumbnail_url TEXT,
  settings JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, slug)
);

-- Seasons
CREATE TABLE seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  number INTEGER NOT NULL,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, number)
);

-- Episodes
CREATE TABLE episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id),
  season_id UUID REFERENCES seasons(id),
  number INTEGER NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft', -- draft, generating, editing, ready, published
  duration_seconds INTEGER,
  thumbnail_url TEXT,
  final_video_url TEXT,
  story_data JSONB,
  screenplay_data JSONB,
  shot_list JSONB,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Shots
CREATE TABLE shots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES episodes(id),
  sequence_number INTEGER NOT NULL,
  duration_seconds INTEGER DEFAULT 10,
  scene_description TEXT,
  action_description TEXT,
  prompt TEXT,
  camera_direction VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending', -- pending, generating, completed, failed
  video_url TEXT,
  generation_metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Assets (Project-Scoped)
CREATE TABLE assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id), -- Always required, assets belong to projects
  type VARCHAR(50) NOT NULL, -- character, location, prop, music, voice, sfx
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(project_id, type, name) -- Unique name per type within project
);

-- Shared Resources (Organization-Level, generic SFX/music only)
CREATE TABLE shared_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  type VARCHAR(50) NOT NULL, -- sfx, music_template, style_preset
  name VARCHAR(255) NOT NULL,
  description TEXT,
  file_url TEXT,
  tags TEXT[],
  is_system BOOLEAN DEFAULT FALSE, -- TRUE for platform-provided resources
  created_at TIMESTAMP DEFAULT NOW()
);

-- Asset Import History (tracks when assets are copied between projects)
CREATE TABLE asset_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_asset_id UUID, -- NULL if from shared resources
  source_shared_id UUID REFERENCES shared_resources(id),
  target_asset_id UUID NOT NULL REFERENCES assets(id),
  source_project_id UUID REFERENCES projects(id),
  target_project_id UUID NOT NULL REFERENCES projects(id),
  imported_by UUID REFERENCES users(id),
  imported_at TIMESTAMP DEFAULT NOW()
);

-- Character Details (extends assets)
CREATE TABLE character_assets (
  asset_id UUID PRIMARY KEY REFERENCES assets(id),
  physical_attributes JSONB,
  personality TEXT,
  element_prompt TEXT,
  reference_images TEXT[], -- Array of URLs
  voice_profile_id UUID REFERENCES assets(id)
);

-- Voice Profiles
CREATE TABLE voice_profiles (
  asset_id UUID PRIMARY KEY REFERENCES assets(id),
  provider VARCHAR(50), -- elevenlabs, playht
  voice_id VARCHAR(255),
  settings JSONB DEFAULT '{}'
);

-- Audio Tracks
CREATE TABLE audio_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES episodes(id),
  type VARCHAR(50) NOT NULL, -- dialogue, music, sfx
  name VARCHAR(255),
  file_url TEXT,
  duration_seconds DECIMAL,
  timeline_start_seconds DECIMAL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Dialogue Lines
CREATE TABLE dialogue_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES episodes(id),
  shot_id UUID REFERENCES shots(id),
  character_asset_id UUID REFERENCES assets(id),
  text TEXT NOT NULL,
  audio_url TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Publishes
CREATE TABLE publishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID REFERENCES episodes(id),
  platform VARCHAR(50) NOT NULL, -- youtube, tiktok, instagram, facebook
  platform_content_id VARCHAR(255),
  platform_url TEXT,
  content_type VARCHAR(50), -- full, short
  title VARCHAR(500),
  description TEXT,
  tags TEXT[],
  thumbnail_url TEXT,
  status VARCHAR(50) DEFAULT 'scheduled', -- scheduled, publishing, published, failed
  scheduled_at TIMESTAMP,
  published_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Analytics Snapshots
CREATE TABLE analytics_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_id UUID REFERENCES publishes(id),
  snapshot_date DATE NOT NULL,
  views BIGINT DEFAULT 0,
  likes BIGINT DEFAULT 0,
  comments BIGINT DEFAULT 0,
  shares BIGINT DEFAULT 0,
  watch_time_seconds BIGINT DEFAULT 0,
  subscribers_gained INTEGER DEFAULT 0,
  revenue_cents INTEGER DEFAULT 0,
  retention_data JSONB,
  raw_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(publish_id, snapshot_date)
);

-- Generation Jobs
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  job_type VARCHAR(50) NOT NULL, -- video, audio, music, sfx, story
  reference_type VARCHAR(50), -- shot, dialogue, episode
  reference_id UUID,
  provider VARCHAR(50),
  provider_job_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'queued', -- queued, processing, completed, failed
  input_data JSONB,
  output_data JSONB,
  error_message TEXT,
  cost_credits INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- API Keys
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  provider VARCHAR(50) NOT NULL,
  encrypted_key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Platform Connections
CREATE TABLE platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id),
  platform VARCHAR(50) NOT NULL,
  account_id VARCHAR(255),
  account_name VARCHAR(255),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMP,
  scopes TEXT[],
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(organization_id, platform, account_id)
);
```

### 13.2 Indexes

```sql
-- Performance indexes
CREATE INDEX idx_episodes_project ON episodes(project_id);
CREATE INDEX idx_episodes_status ON episodes(status);
CREATE INDEX idx_shots_episode ON shots(episode_id);
CREATE INDEX idx_shots_status ON shots(status);
CREATE INDEX idx_assets_project ON assets(project_id);
CREATE INDEX idx_assets_type ON assets(project_id, type);
CREATE INDEX idx_shared_resources_org ON shared_resources(organization_id);
CREATE INDEX idx_shared_resources_type ON shared_resources(type);
CREATE INDEX idx_publishes_episode ON publishes(episode_id);
CREATE INDEX idx_publishes_platform ON publishes(platform);
CREATE INDEX idx_publishes_status ON publishes(status);
CREATE INDEX idx_analytics_publish ON analytics_snapshots(publish_id);
CREATE INDEX idx_analytics_date ON analytics_snapshots(snapshot_date);
CREATE INDEX idx_jobs_status ON generation_jobs(status);
CREATE INDEX idx_jobs_org ON generation_jobs(organization_id);
```

---

## 14. Non-Functional Requirements

### 14.1 Performance

| Metric | Requirement |
|--------|-------------|
| Page Load Time | < 3 seconds (P95) |
| API Response Time | < 500ms (P95) |
| Video Generation Queue | Start within 60 seconds |
| Render Time | < 2x video duration |
| Concurrent Users | Support 10,000+ |

### 14.2 Scalability

| Component | Scaling Strategy |
|-----------|------------------|
| Web Servers | Horizontal (auto-scale) |
| API Servers | Horizontal (auto-scale) |
| Workers | Horizontal (queue-based) |
| Database | Vertical + Read replicas |
| Storage | Cloud-native (S3/R2) |
| CDN | Global edge (Cloudflare) |

### 14.3 Security

| Requirement | Implementation |
|-------------|----------------|
| Authentication | OAuth 2.0, MFA support |
| Authorization | RBAC (Role-Based Access Control) |
| Data Encryption | TLS 1.3 in transit, AES-256 at rest |
| API Keys | Encrypted storage, never logged |
| Platform Tokens | OAuth refresh, encrypted storage |
| GDPR Compliance | Data export, deletion rights |
| SOC 2 | Target for Year 2 |

### 14.4 Availability

| Metric | Target |
|--------|--------|
| Uptime SLA | 99.9% |
| Recovery Time Objective (RTO) | < 4 hours |
| Recovery Point Objective (RPO) | < 1 hour |
| Backup Frequency | Daily full, hourly incremental |

### 14.5 Monitoring

| Tool | Purpose |
|------|---------|
| Datadog | APM, infrastructure monitoring |
| Sentry | Error tracking, alerting |
| PagerDuty | Incident management |
| Custom Dashboard | Business metrics |

---

## 15. Roadmap & Phases

### Phase 1: MVP (Months 1-3)

**Goal:** Core creation and publishing flow

| Feature | Priority | Status |
|---------|----------|--------|
| User auth & onboarding | P0 | 🔴 |
| Project creation (Series) | P0 | 🔴 |
| Asset library (Characters, Locations) | P0 | 🔴 |
| Story generation (Claude) | P0 | 🔴 |
| Shot list generation | P0 | 🔴 |
| Video generation (Kling) | P0 | 🔴 |
| Voice generation (ElevenLabs) | P0 | 🔴 |
| Basic timeline editor | P0 | 🔴 |
| Auto-stitch | P0 | 🔴 |
| YouTube publish | P0 | 🔴 |
| Basic analytics | P1 | 🔴 |

**MVP Exit Criteria:**
- User can create a 5-minute episode end-to-end
- User can publish to YouTube
- User can view basic view counts

### Phase 2: Multi-Platform (Months 4-6)

| Feature | Priority |
|---------|----------|
| TikTok publishing | P0 |
| Instagram publishing | P0 |
| Facebook publishing | P0 |
| Shorts auto-clipper | P0 |
| Music generation (Suno) | P1 |
| SFX library | P1 |
| Cross-platform analytics | P0 |
| Upload-only mode | P0 |
| Scheduling | P0 |

### Phase 3: Scale & Polish (Months 7-9)

| Feature | Priority |
|---------|----------|
| Team collaboration | P0 |
| Batch episode creation | P1 |
| Advanced timeline editing | P1 |
| Multiple video models (Runway, Hailuo) | P1 |
| AI insights | P1 |
| Custom thumbnails | P1 |
| Film project type | P2 |
| Mobile app (view only) | P2 |

### Phase 4: Enterprise & Growth (Months 10-12)

| Feature | Priority |
|---------|----------|
| Enterprise SSO | P1 |
| API access | P1 |
| White-label options | P2 |
| Advanced analytics | P1 |
| Revenue optimization | P2 |
| Multi-language dubbing | P2 |
| Community features | P2 |

---

## 16. Appendix

### 16.1 Glossary

| Term | Definition |
|------|------------|
| Episode | A single piece of content within a Series |
| Shot | A single video generation (5-10 seconds) |
| Element | Reference image for character consistency (Kling feature) |
| Storyboard | Visual sequence of shots before generation |
| BYOK | Bring Your Own Key - users provide their own API keys |
| Stitching | Combining multiple shots into one video |
| Asset | Character, location, prop, voice, or music belonging to a specific project |
| Shared Resource | Generic SFX or music template available across all projects |
| Project-Scoped | Assets that exist only within one project and cannot be accessed from other projects |

### 16.2 Competitive Analysis

| Competitor | Strengths | Weaknesses | Our Differentiation |
|------------|-----------|------------|---------------------|
| Kapwing | Easy editing | No AI generation | Full AI pipeline |
| Pictory | AI clips | Limited generation | Custom characters |
| Synthesia | Avatar videos | Expensive | Broader style support |
| Descript | Audio editing | No video generation | Cinematic focus |
| InVideo | Templates | Generic | Character continuity |

### 16.3 Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| API provider price increase | Medium | High | Multi-provider support, negotiate contracts |
| Platform API restrictions | Medium | High | Diversify platforms, manual fallback |
| Generation quality issues | Medium | Medium | Multi-model options, quality checks |
| Copyright concerns | Low | High | Clear TOS, content moderation |
| Scaling challenges | Medium | Medium | Cloud-native architecture, load testing |

### 16.4 References

| Resource | URL |
|----------|-----|
| Kling AI Documentation | https://klingai.com |
| PiAPI Documentation | https://piapi.ai/docs |
| ElevenLabs API | https://elevenlabs.io/docs |
| YouTube Data API | https://developers.google.com/youtube |
| TikTok API | https://developers.tiktok.com |
| Instagram Graph API | https://developers.facebook.com/docs/instagram-api |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Nov 2025 | Product Team | Initial draft |
| 2.0 | Dec 2025 | Product Team | Full expansion with API details, pricing, screens |
| 2.1 | Dec 2025 | Product Team | Assets now project-scoped (not global), added Shared Resources, asset import feature |

---

**END OF DOCUMENT**