# StoryBook AI Film Studio - Complete Product Documentation

**From Concept to Multi-Platform Hit.** StoryBook is an AI-powered film studio platform that helps creators manage their entire video production pipeline—from story ideation to YouTube publishing—in one collaborative workspace.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Getting Started](#2-getting-started)
3. [Navigation & Core Concepts](#3-navigation--core-concepts)
4. [Studio Workflow](#4-studio-workflow)
5. [Pre-Production: Building Your Assets](#5-pre-production-building-your-assets)
6. [Episode Production Pipeline](#6-episode-production-pipeline)
7. [Publishing & Distribution](#7-publishing--distribution)
8. [Analytics & Performance](#8-analytics--performance)
9. [Team Collaboration](#9-team-collaboration)
10. [Settings & Configuration](#10-settings--configuration)

---

## 1. Product Overview

### What is StoryBook?

StoryBook is a complete AI-powered film studio designed for content creators and production teams. It streamlines the entire video production workflow:

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Ideation   │───▶│    Story    │───▶│  Screenplay  │───▶│ Visual Studio │───▶│ Audio Studio │
│ (concepts)  │    │ (narrative) │    │  (scenes)    │    │   (shots)     │    │  (timeline)  │
└─────────────┘    └─────────────┘    └──────────────┘    └───────────────┘    └──────────────┘
                                                                                      │
                                                                                      ▼
                                                                ┌──────────────┐    ┌──────────────┐
                                                                │  Analytics   │◀───│   Publish    │
                                                                │ (insights)   │    │ (platforms)  │
                                                                └──────────────┘    └──────────────┘
```

### Key Capabilities

| Capability | Description |
|------------|-------------|
| **AI Story Generation** | Generate complete narratives from concepts using Deepseek V3 |
| **Screenplay Conversion** | Auto-convert stories to industry-standard screenplay format |
| **VEO 3.1 Shot Prompts** | Generate optimized video prompts for AI video generation |
| **Voice Cloning** | Character-specific voices via ElevenLabs/PlayHT |
| **Multi-Platform Publishing** | YouTube, TikTok, Instagram, Facebook, Twitter, LinkedIn |
| **Content Analytics** | Track views, engagement, revenue across all platforms |
| **Team Collaboration** | Multi-user workspaces with role-based permissions |

---

## 2. Getting Started

### Creating an Account

1. Navigate to the StoryBook homepage
2. Click **"Sign Up"** or **"Get Started"**
3. Choose your authentication method:
   - **Email + Password** - Traditional sign up with email verification
   - **Magic Link** - Passwordless login via email link
   - **OAuth** - Sign in with Google, GitHub, or other providers
4. Complete email verification (if required)
5. You're now in your personal workspace!

### Authentication Routes

| Route | Purpose |
|-------|---------|
| `/auth/sign-in` | Login to your account |
| `/auth/sign-up` | Create a new account |
| `/auth/password-reset` | Reset forgotten password |
| `/auth/verify` | Email verification |
| `/auth/confirm` | Confirm account actions |

---

## 3. Navigation & Core Concepts

### Account Types

StoryBook supports two types of accounts:

1. **Personal Accounts** - Individual user workspaces (routes: `/home/(user)/*`)
2. **Team Accounts** - Shared workspaces with multiple members (routes: `/home/[account]/*`)

### Main Navigation Structure

```
/home
├── /(user)/                    # Personal account routes
│   ├── /projects              # Your personal projects
│   ├── /billing               # Personal billing & subscription
│   └── /settings              # Personal account settings
│
└── /[account]/                 # Team account routes (e.g., /home/storybook/)
    ├── /studio                 # Studio home - all projects
    │   ├── /[projectSlug]     # Project overview & dashboard
    │   │   ├── /episodes      # Episode management
    │   │   ├── /assets        # Characters & locations
    │   │   ├── /audio-library # Shared audio assets
    │   │   ├── /settings      # Project settings
    │   │   └── /analytics     # Project analytics
    │   ├── /projects          # Project list
    │   ├── /analytics         # Cross-project analytics
    │   └── /templates         # Reusable templates
    ├── /members               # Team member management
    ├── /billing               # Team billing & subscription
    └── /settings              # Team settings & configuration
```

### The Studio Concept

A **Studio** is your production workspace within a team account. Each studio contains:

- **Projects** - A project represents a series or content brand (e.g., "Life Lessons Daily")
- **Episodes** - Individual content pieces within a project
- **Assets** - Reusable characters, locations, and audio

---

## 4. Studio Workflow

### Accessing the Studio

1. From the sidebar, select your team account
2. Navigate to **Studio** from the main menu
3. You'll see all projects in your studio

### Project Overview

When you select a project, you'll see the **Project Dashboard** with:

- **Stats Bar** - Total episodes, in-progress, published counts
- **Recent Episodes** - Quick access to latest work
- **Production Status** - Overview of content in each stage
- **Quick Actions** - Create episode, view analytics

### Creating a New Project

1. From Studio home, click **"New Project"**
2. Enter project details:
   - **Name** - Your project/series title
   - **Description** - Brief summary
   - **Cover Image** - Project thumbnail
   - **Genre** - Content genre (comedy, drama, educational, etc.)
3. Configure settings (optional):
   - **Aesthetic Style** - Visual style preferences
   - **Default Duration** - Target episode length
4. Click **"Create Project"**

---

## 5. Pre-Production: Building Your Assets

Before creating episodes, build your **Production Bible** - a library of reusable assets.

### Characters

Navigate to: `/home/[account]/studio/[project]/assets`

**Creating a Character:**

1. Click **"Add Character"**
2. Fill in character details:
   - **Name** - Character name
   - **Role** - Main, Supporting, Recurring, Cameo
   - **Appearance** - 15+ visual attributes:
     - Age, ethnicity, hair color/style
     - Eye color, build, height
     - Clothing style, distinguishing features
   - **Personality** - Traits, quirks, speech patterns
   - **Voice Profile** - Tone, accent, emotional range
   - **Reference Image** - Upload or generate
3. Click **"Save Character"**

> [!TIP]
> Detailed character descriptions improve AI story generation and ensure visual consistency in VEO prompts.

### Locations

**Creating a Location:**

1. Click **"Add Location"**
2. Define location details:
   - **Name** - Location identifier
   - **Type** - Interior/Exterior
   - **Description** - Detailed environment description
   - **Atmosphere** - Mood, lighting, weather
   - **Time Period** - Modern, historical, fantasy, etc.
   - **Reference Image** - Visual reference
3. Click **"Save Location"**

### Audio Library

Navigate to: `/home/[account]/studio/[project]/audio-library`

The Audio Library stores reusable audio assets:

- **Sound Effects** - Shared SFX for episodes
- **Music Tracks** - Background music
- **Voice Samples** - Character voice recordings

---

## 6. Episode Production Pipeline

The heart of StoryBook is the **Episode Production Pipeline** - a 7-tab workflow for creating video content.

### Episode Management

Navigate to: `/home/[account]/studio/[project]/episodes`

**Creating an Episode:**

1. Click **"New Episode"**
2. Enter basic info:
   - **Title** - Episode title
   - **Season** - Season number (if applicable)
   - **Episode Number** - Position in series
3. Click **"Create"**

You'll be taken to the episode studio with 7 production tabs.

---

### Tab 1: Ideation

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/ideation`

**Purpose:** Refine your concept before writing.

**Features:**

1. **Concept Input**
   - Episode title and logline
   - Genre selection
   - Target audience
   - Key themes/topics

2. **Duration Selector**
   - Choose target length: 1 min, 5 min, 30 min, 1 hour, 2 hours
   - Content scaling preview shows expected word counts, scenes, shots

3. **Content Style**
   | Style | Use Case | Dialogue Multiplier |
   |-------|----------|---------------------|
   | Dialogue-Heavy | Kids shows, comedies | 1.5x |
   | Balanced | General content | 1.0x |
   | Action-Heavy | Action sequences | 0.5x |

4. **AI Brainstorming** (optional)
   - Generate concept variations
   - Explore alternative directions

**Output:** Finalized concept ready for story generation.

---

### Tab 2: Story

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/story`

**Purpose:** Generate and refine the full narrative.

**Features:**

1. **AI Story Generation**
   - Click **"Generate Story"**
   - AI (Deepseek V3) creates complete narrative based on:
     - Your concept from Ideation
     - Character definitions
     - Previous episode summaries (SCORE framework)

2. **Story Components Generated:**
   - **Logline** - One-sentence summary
   - **Premise** - The core conflict/hook
   - **Full Story** - Complete narrative text
   - **Act Breakdown** - Three-act structure
   - **Character Arcs** - Per-character development
   - **Themes** - Underlying messages

3. **SCORE Framework** (for series continuity):
   - **Episode Summary** - 2-3 sentence plot summary
   - **Sentiment Score** - Emotional tone (0-1)
   - **Key Events** - Plot points affecting future episodes

4. **Manual Editing**
   - Rich text editor for refinements
   - Version history

**Output:** Approved story ready for screenplay conversion.

---

### Tab 3: Screenplay

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/screenplay`

**Purpose:** Convert story to industry-standard screenplay format.

**Features:**

1. **AI Screenplay Conversion**
   - Click **"Convert to Screenplay"**
   - Story is transformed into formatted scenes

2. **Scene Structure:**
   ```
   SCENE 1 - INT. MAYA'S OFFICE - DAY
   
   Description: Maya sits at her cluttered desk, laptop open...
   
   MAYA
   (frustrated)
   This report is never going to finish itself.
   
   JAMES (O.S.)
   Need a hand?
   ```

3. **Scene Components:**
   - **Scene Number** - Sequential identifier
   - **Heading** - Location + time of day
   - **Description** - Action and environment
   - **Dialogue** - Character lines with direction
   - **Estimated Duration** - Per-scene timing

4. **Scene Editor**
   - Add/remove scenes
   - Reorder scenes (drag-and-drop)
   - Edit dialogue and descriptions

**Output:** Finalized screenplay ready for visual breakdown.

---

### Tab 4: Visual Studio

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/visual-studio`

**Purpose:** Generate shot list with VEO 3.1 optimized prompts.

**Features:**

1. **AI Shot Generation**
   - Scene-by-scene processing, scenes in parallel
   - Click **"Generate Shot List"**
   - Configure:
     - Shot duration (min/max seconds)
     - Video provider (VEO 3.1)

2. **VEO 3.1 Prompt Structure** (7 components):
   | Component | Content |
   |-----------|---------|
   | SUBJECT | 15+ character attributes (age, ethnicity, hair, eyes, build) |
   | ACTION | Movements, gestures, timing, micro-expressions |
   | SCENE | Environment, props, lighting, weather |
   | STYLE | Camera shot, angle, movement, aesthetic |
   | DIALOGUE | `"[Name]: 'text' (Tone: emotion)"` |
   | SOUNDS | Ambient audio + sound effects |
   | NEGATIVE | Exclude subtitles, captions, watermarks |

3. **Shot Management:**
   - View all shots in sequence
   - Edit individual prompts
   - Track status: Pending → Generating → Completed → Approved
   - View generated videos

4. **Reference Images:**
   - Characters and locations automatically attached
   - Used as "ingredients" for VEO generation

**Output:** Complete shot list with video prompts and generated clips.

---

### Tab 5: Audio Studio

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/audio-studio`

**Purpose:** Generate dialogue audio and music.

**Features:**

1. **Dialogue Timeline**
   - Visual timeline of all dialogue lines
   - Synced to shot timing

2. **Voice Assignment**
   - Map characters to voice profiles
   - ElevenLabs/PlayHT integration
   - Voice cloning for consistent characters

3. **TTS Generation**
   - Queue dialogue for generation
   - Generate all or individual lines
   - Review and re-generate as needed

4. **Music Tracks**
   - Add background music
   - ElevenLabs music generation from music cues
   - Manual upload option

5. **Sound Effects**
   - Per-shot ambient audio
   - Access shared SFX library

**Output:** Complete audio package (dialogue + music + SFX).

---

### Tab 6: Shorts Studio

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/shorts-studio`

**Purpose:** Create short-form content from episodes.

**Features:**

1. **Shorts Groups**
   - Organize clips into groups
   - Upload vertical video clips

2. **Multi-Language Support**
   - Assign language per clip
   - Multi-language publishing workflow

**Output:** Ready-to-publish shorts content.

---

### Tab 7: Publish

**Route:** `/home/[account]/studio/[project]/episodes/[episode]/publish`

**Purpose:** Distribute content to social platforms.

**Features:**

1. **Connected Platforms**
   - YouTube
   - TikTok
   - Instagram
   - Facebook
   - Twitter
   - LinkedIn

2. **Publishing Flow:**
   1. Select target platform(s)
   2. Customize metadata per platform:
      - Title, description, tags
      - Thumbnail (supports multi-language)
      - Visibility (public, private, unlisted)
   3. Schedule or publish immediately

3. **Multi-Language Publishing**
   - Separate channels per language
   - Auto-translate titles/descriptions
   - Language-specific thumbnails

4. **OAuth Connection**
   - One-time platform authorization
   - Automatic token refresh

**Output:** Published content across selected platforms.

---

## 7. Publishing & Distribution

### Connecting Platforms

Navigate to: `/home/[account]/studio/[project]/platforms`

**Supported Platforms:**

| Platform | Features |
|----------|----------|
| **YouTube** | Long-form, Shorts, Analytics |
| **TikTok** | Short-form, Upload, Analytics |
| **Instagram** | Reels, Stories, Feed posts |
| **Facebook** | Pages, Reels |
| **Twitter** | Video posts |
| **LinkedIn** | Professional video content |

**To Connect a Platform:**

1. Click platform icon
2. Click **"Connect"**
3. Authorize via OAuth
4. Grant required permissions
5. Platform appears in connected list

**Connection Status:**
- 🟢 **Active** - Ready to publish
- 🟡 **Expired** - Token needs refresh
- 🔴 **Error** - Re-authorization required

### Multi-Language Channels

Configure different channels for each language:

1. Go to **Settings > Platforms**
2. For each platform, add channels
3. Assign target language (en, hi, es, etc.)
4. Content publishes to correct channel based on language

---

## 8. Analytics & Performance

### Accessing Analytics

Navigate to: `/home/[account]/studio/[project]/analytics` or `/home/[account]/studio/analytics`

### Metrics Tracked

**Core Metrics:**
| Metric | Description |
|--------|-------------|
| **Views** | Total video views |
| **Likes** | Engagement via likes |
| **Comments** | Viewer comments |
| **Shares** | Content shares |
| **Watch Time** | Total seconds watched |
| **Subscribers Gained** | New channel subscribers |
| **Revenue** | Ad revenue (cents) |

**Platform-Specific Metrics:**
- **YouTube** - Ad revenue, Premium revenue, retention curves
- **TikTok** - Saves, engagement rate
- **Instagram** - Reach, saves, profile visits

### Analytics Features

1. **Overview Dashboard**
   - Totals cards with trend indicators
   - Comparison to previous period

2. **Time Series Charts**
   - Daily/weekly/monthly views
   - Multi-platform comparison

3. **Top Content**
   - Best performing videos
   - Engagement rate rankings

4. **Audience Insights**
   - Demographics (age, gender)
   - Geography (countries, cities)
   - Device types (mobile, desktop, TV)

5. **AI Insights**
   - Automated trend analysis
   - Content recommendations
   - Posting strategy suggestions
   - Audience pattern detection

---

## 9. Team Collaboration

### Team Accounts

Create a team to collaborate with others:

1. From sidebar, click **"Create Team"**
2. Enter team name and configure settings
3. Team account created!

### Inviting Members

Navigate to: `/home/[account]/members`

1. Click **"Invite Member"**
2. Enter email address
3. Select role:
   | Role | Permissions |
   |------|-------------|
   | **Owner** | Full control, billing, delete team |
   | **Admin** | Manage members, all features |
   | **Member** | Create/edit content |
4. Send invitation

### Project-Level Roles

Within projects, additional roles apply:

| Role | Access |
|------|--------|
| **Owner** | Full project control, delete project |
| **Admin** | Manage members, edit settings |
| **Member** | Edit project content |
| **Viewer** | Read-only access |

---

## 10. Settings & Configuration

### Project Settings

Navigate to: `/home/[account]/studio/[project]/settings`

**Configuration Options:**

1. **General**
   - Project name, description
   - Cover image
   - Genre/category

2. **Visual Style**
   - Default aesthetic (cinematic, animated, etc.)
   - Color palette preferences
   - Camera style defaults

3. **Audio**
   - Default voice settings
   - Music preferences

4. **Publishing Defaults**
   - Default visibility
   - Thumbnail templates
   - Description templates

5. **API Keys**
   - ElevenLabs API key
   - Additional service integrations

### Account Settings

Navigate to: `/home/[account]/settings`

1. **Team Profile** - Team name, logo, description
2. **Billing** - Subscription, payment methods, invoices
3. **Members** - Team member management
4. **Security** - MFA, session management

---

## Quick Reference

### Episode Status Flow

```
draft → story → screenplay → storyboard → generating → editing → ready → published
```

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Save | `Ctrl/Cmd + S` |
| Generate (AI) | `Ctrl/Cmd + G` |
| Navigate tabs | `Ctrl/Cmd + 1-7` |

### Support Resources

- **Documentation** - In-app help guides
- **Keyboard Shortcuts** - `?` anywhere in app
- **Support** - Settings > Help & Support

---

## Summary

StoryBook transforms video production by providing an end-to-end AI-powered workflow:

1. **Ideation** → Define concept and duration
2. **Story** → AI-generate complete narrative
3. **Screenplay** → Convert to formatted scenes
4. **Visual Studio** → Generate VEO 3.1 shot prompts
5. **Audio Studio** → Create dialogue and music
6. **Shorts Studio** → Prepare short-form content
7. **Publish** → Distribute to 6+ platforms

With team collaboration, multi-language support, and comprehensive analytics, StoryBook is the complete solution for modern content creators.
