# System Architecture

This document provides a comprehensive overview of the content generation pipeline architecture, including detailed flow diagrams with data structures.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Episode Workflow Pipeline](#episode-workflow-pipeline)
3. [Scene-by-Scene Shot Generation](#scene-by-scene-shot-generation)
4. [VEO 3.1 Prompt Structure](#veo-31-prompt-structure)
5. [Prompt Engine Architecture](#prompt-engine-architecture)
6. [Audio Studio Timeline](#audio-studio-timeline)
7. [Database Schema Overview](#database-schema-overview)
8. [Context Builder System](#context-builder-system)
9. [Duration-Based Content Scaling](#duration-based-content-scaling)
10. [SCORE Framework](#score-framework)

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                              STORYBOOK CONTENT GENERATION PLATFORM                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              FRONTEND (Next.js 15 + React 19)                    │  │
│   │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │  │
│   │   │  Ideation   │ │   Story     │ │ Screenplay  │ │   Visual    │ │   Audio   │ │  │
│   │   │   Studio    │ │   Studio    │ │   Studio    │ │   Studio    │ │   Studio  │ │  │
│   │   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                          │
│                                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              SERVER LAYER (Server Actions)                       │  │
│   │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │  │
│   │   │   story-    │ │ screenplay- │ │  shot-list- │ │    audio-   │ │  context- │ │  │
│   │   │   actions   │ │   actions   │ │   actions   │ │   actions   │ │  builder  │ │  │
│   │   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                          │
│                                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              PROMPT ENGINE (@kit/prompt-engine)                  │  │
│   │   ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────────────┐   │  │
│   │   │  JSON Templates   │  │   Variable        │  │   LLM Providers           │   │  │
│   │   │  (version-ctrl)   │  │   Substitution    │  │   (OpenAI, DeepSeek, etc) │   │  │
│   │   └───────────────────┘  └───────────────────┘  └───────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                          │
│                                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │                              DATABASE (Supabase PostgreSQL)                      │  │
│   │   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │  │
│   │   │  episodes   │ │   shots     │ │  dialogue   │ │  episode    │ │   llm_    │ │  │
│   │   │   (JSONB)   │ │   table     │ │   _lines    │ │   _music    │ │  analytics│ │  │
│   │   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘ └───────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### Key Packages

| Package | Description |
|---------|-------------|
| `@kit/episodes` | Episode management, story/screenplay generation, shot lists |
| `@kit/prompt-engine` | JSON-based LLM prompt templates with Zod validation |
| `@kit/audio-generation` | TTS, voice cloning, music generation |
| `@kit/content-analytics` | Platform performance insights |
| `@kit/llm` | LLM abstraction layer (OpenAI, Anthropic, Gemini, DeepSeek) |

---

## Episode Workflow Pipeline

The platform uses a 5-stage content generation pipeline where each stage builds on the previous.

```
                              EPISODE WORKFLOW PIPELINE
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  STAGE 1: IDEATION                                                                 │ │
│  │  Route: /studio/[projectId]/episodes/[episodeId]/ideation                          │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  INPUT:                                                                      │  │ │
│  │  │  • User provides: title, concept, genre, target audience, duration           │  │ │
│  │  │  • Optional: character sketches, themes, tone preferences                    │  │ │
│  │  │                                                                              │  │ │
│  │  │  PROCESS:                                                                    │  │ │
│  │  │  • executeLLM('story-ideation', { concept, genre, audience })                │  │ │
│  │  │                                                                              │  │ │
│  │  │  OUTPUT: story_ideas[] with loglines, premises, character concepts           │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                              │                                          │
│                                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  STAGE 2: STORY GENERATION                                                        │ │
│  │  Route: /studio/[projectId]/episodes/[episodeId]/story                            │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  INPUT:                                                                      │  │ │
│  │  │  • Selected story idea or user-provided premise                              │  │ │
│  │  │  • Target duration, content style (dialogue-heavy/action-heavy/balanced)     │  │ │
│  │  │  • SCORE context from previous episodes (if series)                          │  │ │
│  │  │                                                                              │  │ │
│  │  │  PROCESS:                                                                    │  │ │
│  │  │  • calculateContentScaling(targetDuration, contentStyle) → scaling params    │  │ │
│  │  │  • executeLLM('story-generation', { premise, scaling, previousEpisodes })    │  │ │
│  │  │                                                                              │  │ │
│  │  │  OUTPUT → episodes.story_data (JSONB):                                       │  │ │
│  │  │  ┌───────────────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │  story_data = {                                                       │   │  │ │
│  │  │  │    title: string,                                                     │   │  │ │
│  │  │  │    logline: string,           // 1-2 sentence hook                    │   │  │ │
│  │  │  │    premise: string,           // Detailed story premise               │   │  │ │
│  │  │  │    fullStory: string,         // Complete narrative                   │   │  │ │
│  │  │  │    actBreakdown: {                                                    │   │  │ │
│  │  │  │      act1: { summary, keyEvents[] },                                  │   │  │ │
│  │  │  │      act2: { summary, keyEvents[] },                                  │   │  │ │
│  │  │  │      act3: { summary, keyEvents[] }                                   │   │  │ │
│  │  │  │    },                                                                 │   │  │ │
│  │  │  │    characters: [                                                      │   │  │ │
│  │  │  │      { name, role, arc, physicalDescription, personality }            │   │  │ │
│  │  │  │    ],                                                                 │   │  │ │
│  │  │  │    themes: string[],                                                  │   │  │ │
│  │  │  │    // SCORE Framework fields:                                         │   │  │ │
│  │  │  │    episodeSummary: string,     // For next episode context            │   │  │ │
│  │  │  │    sentimentScore: number,     // Emotional arc tracking              │   │  │ │
│  │  │  │    keyEvents: string[],        // Series continuity                   │   │  │ │
│  │  │  │    characterGrowth: {}         // Character development tracking      │   │  │ │
│  │  │  │  }                                                                    │   │  │ │
│  │  │  └───────────────────────────────────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                              │                                          │
│                                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  STAGE 3: SCREENPLAY CONVERSION                                                   │ │
│  │  Route: /studio/[projectId]/episodes/[episodeId]/screenplay                       │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  INPUT:                                                                      │  │ │
│  │  │  • story_data from previous stage                                            │  │ │
│  │  │  • Character registry, location registry                                     │  │ │
│  │  │  • Duration scaling parameters                                               │  │ │
│  │  │                                                                              │  │ │
│  │  │  PROCESS:                                                                    │  │ │
│  │  │  • executeLLM('screenplay-conversion', { story, characters, locations })     │  │ │
│  │  │                                                                              │  │ │
│  │  │  OUTPUT → episodes.screenplay_data (JSONB):                                  │  │ │
│  │  │  ┌───────────────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │  screenplay_data = {                                                  │   │  │ │
│  │  │  │    scenes: [                                                          │   │  │ │
│  │  │  │      {                                                                │   │  │ │
│  │  │  │        number: number,                                                │   │  │ │
│  │  │  │        heading: string,        // "INT. COFFEE SHOP - DAY"            │   │  │ │
│  │  │  │        location: string,       // "COFFEE SHOP"                       │   │  │ │
│  │  │  │        timeOfDay: string,      // "DAY" | "NIGHT" | "DAWN" | etc      │   │  │ │
│  │  │  │        description: string,    // Action/scene description            │   │  │ │
│  │  │  │        dialogue: [                                                    │   │  │ │
│  │  │  │          {                                                            │   │  │ │
│  │  │  │            character: string,                                         │   │  │ │
│  │  │  │            text: string,                                              │   │  │ │
│  │  │  │            parenthetical?: string,  // "(angrily)"                    │   │  │ │
│  │  │  │            emotion?: string                                           │   │  │ │
│  │  │  │          }                                                            │   │  │ │
│  │  │  │        ],                                                             │   │  │ │
│  │  │  │        estimatedDuration: number  // seconds                          │   │  │ │
│  │  │  │      }                                                                │   │  │ │
│  │  │  │    ],                                                                 │   │  │ │
│  │  │  │    metadata: {                                                        │   │  │ │
│  │  │  │      totalScenes: number,                                             │   │  │ │
│  │  │  │      estimatedDuration: number,                                       │   │  │ │
│  │  │  │      dialogueCount: number                                            │   │  │ │
│  │  │  │    }                                                                  │   │  │ │
│  │  │  │  }                                                                    │   │  │ │
│  │  │  └───────────────────────────────────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                              │                                          │
│                                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  STAGE 4: VISUAL STUDIO (Shot Generation)                                        │ │
│  │  Route: /studio/[projectId]/episodes/[episodeId]/visual-studio                    │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  INPUT:                                                                      │  │ │
│  │  │  • screenplay_data.scenes from previous stage                                │  │ │
│  │  │  • Character registry with reference images                                  │  │ │
│  │  │  • Location registry with reference images                                   │  │ │
│  │  │                                                                              │  │ │
│  │  │  PROCESS: (See Scene-by-Scene Shot Generation section below)                 │  │ │
│  │  │  • buildGlobalShotContext(episodeId) → global registries + metadata          │  │ │
│  │  │  • For each scene:                                                           │  │ │
│  │  │    - filterContextForScene(scene, globalContext) → 50-80% token savings      │  │ │
│  │  │    - executeLLM('scene-shot-generation', { filteredContext, scene })         │  │ │
│  │  │  • aggregateSceneResults() → unified shot list                               │  │ │
│  │  │  • batchCreateShotsAction() → persist to shots table                         │  │ │
│  │  │                                                                              │  │ │
│  │  │  OUTPUT → episodes.shot_list (JSONB) + shots table:                          │  │ │
│  │  │  ┌───────────────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │  shot_list = {                                                        │   │  │ │
│  │  │  │    shots: [                                                           │   │  │ │
│  │  │  │      {                                                                │   │  │ │
│  │  │  │        sequenceNumber: number,     // Global ordering                 │   │  │ │
│  │  │  │        sceneNumber: number,                                           │   │  │ │
│  │  │  │        duration: number,           // seconds                         │   │  │ │
│  │  │  │        sceneDescription: string,                                      │   │  │ │
│  │  │  │        cameraDirection: CameraDirection,                              │   │  │ │
│  │  │  │        characters: string[],                                          │   │  │ │
│  │  │  │        veoPrompt: VeoPrompt,       // 7-component structure           │   │  │ │
│  │  │  │        dialogueTiming: DialogueTiming[]                               │   │  │ │
│  │  │  │      }                                                                │   │  │ │
│  │  │  │    ],                                                                 │   │  │ │
│  │  │  │    generatedAt: ISO8601,                                              │   │  │ │
│  │  │  │    metadata: {                                                        │   │  │ │
│  │  │  │      totalShots: number,                                              │   │  │ │
│  │  │  │      totalDuration: number,                                           │   │  │ │
│  │  │  │      referenceImages: { characters[], locations[] }                   │   │  │ │
│  │  │  │    }                                                                  │   │  │ │
│  │  │  │  }                                                                    │   │  │ │
│  │  │  └───────────────────────────────────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                              │                                          │
│                                              ▼                                          │
│  ┌───────────────────────────────────────────────────────────────────────────────────┐ │
│  │  STAGE 5: AUDIO STUDIO                                                            │ │
│  │  Route: /studio/[projectId]/episodes/[episodeId]/audio-studio                     │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  INPUT:                                                                      │  │ │
│  │  │  • shot_list with dialogueTiming from Visual Studio                          │  │ │
│  │  │  • Character voice assignments                                               │  │ │
│  │  │  • Music preferences                                                         │  │ │
│  │  │                                                                              │  │ │
│  │  │  PROCESS:                                                                    │  │ │
│  │  │  • Extract dialogue_lines from shots                                         │  │ │
│  │  │  • Queue TTS generation per line                                             │  │ │
│  │  │  • Generate/select background music tracks                                   │  │ │
│  │  │  • Timeline-based audio mixing                                               │  │ │
│  │  │                                                                              │  │ │
│  │  │  OUTPUT → dialogue_lines + episode_music tables:                             │  │ │
│  │  │  ┌───────────────────────────────────────────────────────────────────────┐   │  │ │
│  │  │  │  dialogue_lines = {                                                   │   │  │ │
│  │  │  │    shot_id: uuid,                                                     │   │  │ │
│  │  │  │    character_name: string,                                            │   │  │ │
│  │  │  │    text: string,                                                      │   │  │ │
│  │  │  │    emotion: string,                                                   │   │  │ │
│  │  │  │    start_time: number,     // seconds from episode start              │   │  │ │
│  │  │  │    duration: number,                                                  │   │  │ │
│  │  │  │    audio_url: string,      // generated TTS audio                     │   │  │ │
│  │  │  │    voice_id: string        // assigned voice                          │   │  │ │
│  │  │  │  }                                                                    │   │  │ │
│  │  │  └───────────────────────────────────────────────────────────────────────┘   │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Scene-by-Scene Shot Generation

This is the core innovation for scalable shot list generation. Instead of processing the entire screenplay at once (which hits token limits), we process each scene individually with filtered context.

```
                        SCENE-BY-SCENE SHOT GENERATION PIPELINE
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                          │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │  1. BUILD GLOBAL CONTEXT (Once per episode)                                       │  │
│   │  ┌────────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  buildGlobalShotContext(episodeId): GlobalShotContext                       │  │  │
│   │  │                                                                             │  │  │
│   │  │  ┌─────────────────────────────────────────────────────────────────────┐   │  │  │
│   │  │  │  GlobalShotContext = {                                              │   │  │  │
│   │  │  │    characterRegistry: CharacterRegistryEntry[],                     │   │  │  │
│   │  │  │    //  name, role, physicalDescription, personality, referenceImage │   │  │  │
│   │  │  │                                                                     │   │  │  │
│   │  │  │    locationRegistry: LocationRegistryEntry[],                       │   │  │  │
│   │  │  │    //  name, description, atmosphere, referenceImage                │   │  │  │
│   │  │  │                                                                     │   │  │  │
│   │  │  │    episodeMetadata: {                                               │   │  │  │
│   │  │  │      title, genre, targetDuration, contentStyle                     │   │  │  │
│   │  │  │    },                                                               │   │  │  │
│   │  │  │                                                                     │   │  │  │
│   │  │  │    referenceImages: {                                               │   │  │  │
│   │  │  │      characters: { name, url }[],                                   │   │  │  │
│   │  │  │      locations: { name, url }[]                                     │   │  │  │
│   │  │  │    }                                                                │   │  │  │
│   │  │  │  }                                                                  │   │  │  │
│   │  │  └─────────────────────────────────────────────────────────────────────┘   │  │  │
│   │  └────────────────────────────────────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                           │
│                                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │  2. PROCESS EACH SCENE SEQUENTIALLY                                              │  │
│   │                                                                                   │  │
│   │     for (scene of screenplay.scenes) {                                           │  │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐ │  │
│   │   │  2a. FILTER CONTEXT FOR SCENE (Token Optimization)                         │ │  │
│   │   │  ┌──────────────────────────────────────────────────────────────────────┐  │ │  │
│   │   │  │  filterContextForScene(scene, globalContext): SceneFilteredContext   │  │ │  │
│   │   │  │                                                                       │  │ │  │
│   │   │  │  BEFORE FILTERING:                    AFTER FILTERING:                │  │ │  │
│   │   │  │  ┌─────────────────────┐              ┌─────────────────────┐         │  │ │  │
│   │   │  │  │ All 12 characters   │     ───►     │ 2-3 scene chars    │         │  │ │  │
│   │   │  │  │ All 8 locations     │              │ 1 scene location   │         │  │ │  │
│   │   │  │  │ ~4000 tokens        │              │ ~800 tokens        │         │  │ │  │
│   │   │  │  └─────────────────────┘              └─────────────────────┘         │  │ │  │
│   │   │  │                                                                       │  │ │  │
│   │   │  │  TOKEN SAVINGS: 50-80%                                                │  │ │  │
│   │   │  │                                                                       │  │ │  │
│   │   │  │  Filtering Logic:                                                     │  │ │  │
│   │   │  │  • extractSceneCharacters(scene) → names from dialogue + description │  │ │  │
│   │   │  │  • Match against characterRegistry                                    │  │ │  │
│   │   │  │  • Extract location from scene.heading                                │  │ │  │
│   │   │  │  • Match against locationRegistry                                     │  │ │  │
│   │   │  └──────────────────────────────────────────────────────────────────────┘  │ │  │
│   │   └────────────────────────────────────────────────────────────────────────────┘ │  │
│   │                                              │                                    │  │
│   │                                              ▼                                    │  │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐ │  │
│   │   │  2b. GENERATE SHOTS FOR SCENE (LLM Call)                                   │ │  │
│   │   │  ┌──────────────────────────────────────────────────────────────────────┐  │ │  │
│   │   │  │  executeLLM('scene-shot-generation', {                               │  │ │  │
│   │   │  │    scene_number,                                                     │  │ │  │
│   │   │  │    total_scenes,                                                     │  │ │  │
│   │   │  │    characters: formatFilteredCharactersForPrompt(sceneContext),      │  │ │  │
│   │   │  │    locations: formatFilteredLocationsForPrompt(sceneContext),        │  │ │  │
│   │   │  │    episode_metadata: JSON.stringify(sceneContext.episodeMetadata),   │  │ │  │
│   │   │  │    previous_scene_summary,    // Narrative bridge                    │  │ │  │
│   │   │  │    scene_content: formatSceneForPrompt(scene)                        │  │ │  │
│   │   │  │  })                                                                  │  │ │  │
│   │   │  │                                                                      │  │ │  │
│   │   │  │  OUTPUT: SceneShotGenerationOutput                                   │  │ │  │
│   │   │  │  ┌────────────────────────────────────────────────────────────────┐  │  │ │  │
│   │   │  │  │  {                                                             │  │  │ │  │
│   │   │  │  │    shots: [                                                    │  │  │ │  │
│   │   │  │  │      {                                                         │  │  │ │  │
│   │   │  │  │        shotNumber, shotType, cameraDirection,                  │  │  │ │  │
│   │   │  │  │        description, action, prompt, characters,                │  │  │ │  │
│   │   │  │  │        duration, metadata, veoPrompt, dialogueTiming           │  │  │ │  │
│   │   │  │  │      }                                                         │  │  │ │  │
│   │   │  │  │    ],                                                          │  │  │ │  │
│   │   │  │  │    sceneSummary: string  // Used as context for next scene     │  │  │ │  │
│   │   │  │  │  }                                                             │  │  │ │  │
│   │   │  │  └────────────────────────────────────────────────────────────────┘  │  │ │  │
│   │   │  └──────────────────────────────────────────────────────────────────────┘  │ │  │
│   │   └────────────────────────────────────────────────────────────────────────────┘ │  │
│   │                                              │                                    │  │
│   │                                              ▼                                    │  │
│   │   ┌────────────────────────────────────────────────────────────────────────────┐ │  │
│   │   │  2c. COLLECT RESULT & UPDATE CONTEXT                                       │ │  │
│   │   │  ┌──────────────────────────────────────────────────────────────────────┐  │ │  │
│   │   │  │  sceneResults.push({                                                 │  │ │  │
│   │   │  │    sceneNumber,                                                      │  │ │  │
│   │   │  │    shots: result.data.shots,                                         │  │ │  │
│   │   │  │    sceneSummary: result.data.sceneSummary                            │  │ │  │
│   │   │  │  });                                                                 │  │ │  │
│   │   │  │                                                                      │  │ │  │
│   │   │  │  // Use this summary as context for NEXT scene (narrative bridge)   │  │ │  │
│   │   │  │  previousSceneSummary = result.data.sceneSummary;                    │  │ │  │
│   │   │  └──────────────────────────────────────────────────────────────────────┘  │ │  │
│   │   └────────────────────────────────────────────────────────────────────────────┘ │  │
│   │     }  // end for loop                                                           │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                           │
│                                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │  3. AGGREGATE RESULTS (Reduce Phase)                                             │  │
│   │  ┌────────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  aggregateSceneResults(sceneResults, globalContext)                         │  │  │
│   │  │                                                                             │  │  │
│   │  │  OPERATIONS:                                                                │  │  │
│   │  │  • Assign global sequenceNumbers (1, 2, 3... across all scenes)             │  │  │
│   │  │  • Attach referenceImages to each shot based on character/location names    │  │  │
│   │  │  • Calculate metadata totals (totalShots, totalDuration, shotTypes)         │  │  │
│   │  │  • Prepare BatchShotDefinition[] for database insertion                     │  │  │
│   │  │                                                                             │  │  │
│   │  │  OUTPUT:                                                                    │  │  │
│   │  │  ┌───────────────────────────────────────────────────────────────────────┐  │  │  │
│   │  │  │  {                                                                    │  │  │  │
│   │  │  │    generatedShots: AggregatedShot[],   // Full shot data              │  │  │  │
│   │  │  │    shotsToCreate: BatchShotDefinition[], // For DB insertion          │  │  │  │
│   │  │  │    totalShots: number,                                                │  │  │  │
│   │  │  │    metadata: {                                                        │  │  │  │
│   │  │  │      totalDuration, shotTypes, locations, characters                  │  │  │  │
│   │  │  │    }                                                                  │  │  │  │
│   │  │  │  }                                                                    │  │  │  │
│   │  │  └───────────────────────────────────────────────────────────────────────┘  │  │  │
│   │  └────────────────────────────────────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                           │
│                                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│   │  4. PERSIST RESULTS                                                              │  │
│   │  ┌────────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  // Insert individual shots into shots table                                │  │  │
│   │  │  await batchCreateShotsAction({                                             │  │  │
│   │  │    episodeId,                                                               │  │  │
│   │  │    shots: aggregated.shotsToCreate                                          │  │  │
│   │  │  });                                                                        │  │  │
│   │  │                                                                             │  │  │
│   │  │  // Update episode with shot_list metadata (JSONB)                          │  │  │
│   │  │  await client.from('episodes').update({                                     │  │  │
│   │  │    shot_list: shotListData,                                                 │  │  │
│   │  │    updated_at: new Date().toISOString()                                     │  │  │
│   │  │  }).eq('id', episodeId);                                                    │  │  │
│   │  └────────────────────────────────────────────────────────────────────────────┘  │  │
│   └──────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                          │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### Why Scene-by-Scene?

| Approach | Token Usage | Scalability | Complexity |
|----------|-------------|-------------|------------|
| **Full Screenplay** | ~8000 tokens | ❌ Limited to short episodes | Low |
| **Scene-by-Scene** | ~1000 tokens/scene | ✅ Unlimited | Medium |
| **Batched Scenes** (future) | ~3000 tokens/batch | ✅ Unlimited | High |

---

## VEO 3.1 Prompt Structure

VEO 3.1 requires a specific 7-component prompt format for optimal video generation results.

```
                              VEO 3.1 PROMPT STRUCTURE (7 Components)
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   veoPrompt: {                                                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  1. SUBJECT (Character Description)                                              │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  15+ physical attributes for consistency:                                  │  │  │
│   │  │  • Age range, ethnicity, gender                                            │  │  │
│   │  │  • Hair (color, length, style, texture)                                    │  │  │
│   │  │  • Eyes (color, shape, distinctive features)                               │  │  │
│   │  │  • Build (height, weight, posture)                                         │  │  │
│   │  │  • Clothing (current scene outfit, colors, style)                          │  │  │
│   │  │  • Distinguishing features (scars, tattoos, accessories)                   │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "A 35-year-old Hispanic woman with long curly black hair,        │  │  │
│   │  │           warm brown eyes, athletic build, wearing a tailored navy blazer  │  │  │
│   │  │           and white silk blouse, silver hoop earrings"                     │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  2. ACTION (Movement & Performance)                                              │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  • Primary physical action with timing                                     │  │  │
│   │  │  • Micro-expressions and facial performance                                │  │  │
│   │  │  • Body language and gestures                                              │  │  │
│   │  │  • Interaction with props/environment                                      │  │  │
│   │  │  • Pacing (slow, deliberate, quick, frantic)                               │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "slowly rises from the chair, her expression shifting from       │  │  │
│   │  │           calm to concerned, hands gripping the armrests, then releasing   │  │  │
│   │  │           as she takes a deep breath and straightens her posture"          │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  3. SCENE (Environment & Setting)                                                │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  • Location type and specific details                                      │  │  │
│   │  │  • Time of day and lighting conditions                                     │  │  │
│   │  │  • Weather and atmospheric elements                                        │  │  │
│   │  │  • Props and set dressing                                                  │  │  │
│   │  │  • Background activity                                                     │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "Modern corner office on the 40th floor, floor-to-ceiling        │  │  │
│   │  │           windows with twilight city skyline, warm desk lamp illumination, │  │  │
│   │  │           minimalist decor, rain droplets on glass"                        │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  4. STYLE (Cinematography)                                                       │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  • Shot type (wide, medium, close-up, extreme close-up)                    │  │  │
│   │  │  • Camera angle (eye-level, low-angle, high-angle, Dutch)                  │  │  │
│   │  │  • Camera movement (static, pan, tilt, dolly, crane)                       │  │  │
│   │  │  • Lighting style (high-key, low-key, natural, dramatic)                   │  │  │
│   │  │  • Color palette/grading                                                   │  │  │
│   │  │  • Visual references (film noir, Wes Anderson, documentary)                │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "Medium shot, eye-level, slow dolly in, warm golden hour         │  │  │
│   │  │           lighting with soft shadows, desaturated color palette with       │  │  │
│   │  │           emphasis on blues and oranges, cinematic 2.39:1 aspect ratio"    │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  5. DIALOGUE (Speech with Timing) - COLON SYNTAX REQUIRED                        │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  Format: "[Character]: 'Dialogue text' (Tone: emotional descriptor)"      │  │  │
│   │  │                                                                            │  │  │
│   │  │  • Character name MUST be followed by colon                                │  │  │
│   │  │  • Dialogue in single quotes                                               │  │  │
│   │  │  • Tone/emotion in parentheses                                             │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "[Elena]: 'I didn't expect to see you here.' (Tone: surprised,   │  │  │
│   │  │           guarded) [Marcus]: 'Neither did I.' (Tone: weary, resigned)"     │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  6. SOUNDS (Audio Design) - PREVENTS AUDIO HALLUCINATIONS                        │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  • Ambient sounds for environment                                          │  │  │
│   │  │  • Specific sound effects                                                  │  │  │
│   │  │  • Absence of unwanted sounds                                              │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "Ambient: soft office HVAC hum, distant city traffic. Effects:   │  │  │
│   │  │           leather chair creak, fabric rustling, heels on marble. No music, │  │  │
│   │  │           no phone sounds, no background conversations."                   │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  7. NEGATIVE PROMPT (Exclusions) - CRITICAL FOR QUALITY                          │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  ALWAYS INCLUDE:                                                           │  │  │
│   │  │  • No subtitles, no captions, no text overlays                             │  │  │
│   │  │  • No watermarks, no logos, no UI elements                                 │  │  │
│   │  │  • No split screens, no picture-in-picture                                 │  │  │
│   │  │  • No blurry footage, no artifacts, no glitches                            │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "No subtitles, no captions, no text overlays, no watermarks,     │  │  │
│   │  │           no logos, no split screens, no shaky cam, no lens flare,         │  │  │
│   │  │           no morphing faces, no extra limbs, no deformed hands"            │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   ├─────────────────────────────────────────────────────────────────────────────────┤  │
│   │  8. FULL PROMPT (Combined Copy-Ready)                                            │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  Concatenation of all 7 components above into a single prompt string      │  │  │
│   │  │  ready to paste directly into VEO 3.1 interface.                           │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example:                                                                  │  │  │
│   │  │  "A 35-year-old Hispanic woman with long curly black hair, warm brown     │  │  │
│   │  │  eyes, athletic build, wearing a navy blazer and white silk blouse.       │  │  │
│   │  │  She slowly rises from the chair, expression shifting from calm to        │  │  │
│   │  │  concerned. Modern corner office, twilight city skyline, warm lamp        │  │  │
│   │  │  illumination. Medium shot, slow dolly in, warm golden hour lighting.     │  │  │
│   │  │  [Elena]: 'I didn't expect to see you here.' (Tone: surprised, guarded)   │  │  │
│   │  │  Sounds: soft office hum, leather chair creak. Negative: No subtitles,    │  │  │
│   │  │  no watermarks, no text overlays, no morphing faces."                     │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│   }                                                                                     │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Prompt Engine Architecture

The prompt engine uses JSON files for version-controlled, type-safe LLM prompt management.

```
                              PROMPT ENGINE ARCHITECTURE
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  PROMPT TEMPLATE STORAGE                                                         │  │
│   │  Location: packages/features/prompt-engine/src/prompts/                          │  │
│   │                                                                                  │  │
│   │  ├── story-generation/                                                           │  │
│   │  │   ├── story-ideation.json        (concept → story ideas)                      │  │
│   │  │   ├── story-generation.json      (story → full narrative with SCORE)          │  │
│   │  │   ├── screenplay-conversion.json (story → formatted scenes)                   │  │
│   │  │   ├── scene-shot-generation.json (scene → VEO shots) ◀── Scalable Pipeline   │  │
│   │  │   ├── season-generation.json     (season → episode outlines)                  │  │
│   │  │   └── season-outline.json        (premise → season structure)                 │  │
│   │  │                                                                               │  │
│   │  └── analytics/                                                                  │  │
│   │      └── insights-generation.json   (metrics → actionable insights)              │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  JSON TEMPLATE STRUCTURE                                                         │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  {                                                                         │  │  │
│   │  │    "slug": "scene-shot-generation",                                        │  │  │
│   │  │    "name": "Scene to Shots Converter",                                     │  │  │
│   │  │    "version": 3,                                                           │  │  │
│   │  │    "category": "story-generation",                                         │  │  │
│   │  │                                                                            │  │  │
│   │  │    "llm": {                                                                │  │  │
│   │  │      "provider": "deepseek",                                               │  │  │
│   │  │      "model": "deepseek-chat",                                             │  │  │
│   │  │      "max_tokens": 8000,                                                   │  │  │
│   │  │      "temperature": 0.4,                                                   │  │  │
│   │  │      "response_format": { "type": "json_object" }                          │  │  │
│   │  │    },                                                                      │  │  │
│   │  │                                                                            │  │  │
│   │  │    "system_prompts": [                                                     │  │  │
│   │  │      { "slug": "role", "layer_type": "role", "content": "..." },           │  │  │
│   │  │      { "slug": "format", "layer_type": "format", "content": "..." }        │  │  │
│   │  │    ],                                                                      │  │  │
│   │  │                                                                            │  │  │
│   │  │    "user_prompt": "Scene {{scene_number}}/{{total_scenes}}:\n...",         │  │  │
│   │  │                                                                            │  │  │
│   │  │    "variables": {                                                          │  │  │
│   │  │      "scene_number": { "type": "number", "required": true },               │  │  │
│   │  │      "characters": { "type": "text", "required": true },                   │  │  │
│   │  │      "scene_content": { "type": "text", "required": true }                 │  │  │
│   │  │    },                                                                      │  │  │
│   │  │                                                                            │  │  │
│   │  │    "output": {                                                             │  │  │
│   │  │      "type": "object",                                                     │  │  │
│   │  │      "schema": {                                                           │  │  │
│   │  │        "type": "zod",                                                      │  │  │
│   │  │        "definition": "z.object({ shots: z.array(...), sceneSummary: ... })"│  │  │
│   │  │      }                                                                     │  │  │
│   │  │    }                                                                       │  │  │
│   │  │  }                                                                         │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                              │                                          │
│                                              ▼                                          │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  EXECUTION FLOW                                                                  │  │
│   │                                                                                  │  │
│   │  ┌────────────────┐    ┌────────────────┐    ┌────────────────┐                 │  │
│   │  │                │    │                │    │                │                 │  │
│   │  │ loadTemplate() │───▶│ buildPrompt()  │───▶│ executeLLM()   │                 │  │
│   │  │                │    │                │    │                │                 │  │
│   │  │  • Locate JSON │    │  • Substitute  │    │  • Call LLM    │                 │  │
│   │  │  • Parse & val │    │    {{vars}}    │    │  • Track usage │                 │  │
│   │  │                │    │  • Build msgs  │    │  • Log cost    │                 │  │
│   │  └────────────────┘    └────────────────┘    └───────┬────────┘                 │  │
│   │                                                       │                          │  │
│   │                                                       ▼                          │  │
│   │                                              ┌────────────────┐                  │  │
│   │                                              │                │                  │  │
│   │                                              │ validateOutput │                  │  │
│   │                                              │                │                  │  │
│   │                                              │  • Zod schema  │                  │  │
│   │                                              │  • Type-safe T │                  │  │
│   │                                              │                │                  │  │
│   │                                              └────────────────┘                  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  USAGE EXAMPLE                                                                   │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  import { executeLLM } from '@kit/prompt-engine/server';                   │  │  │
│   │  │                                                                            │  │  │
│   │  │  const result = await executeLLM<SceneShotGenerationOutput>({              │  │  │
│   │  │    templateSlug: 'scene-shot-generation',                                  │  │  │
│   │  │    variables: {                                                            │  │  │
│   │  │      scene_number: 3,                                                      │  │  │
│   │  │      total_scenes: 12,                                                     │  │  │
│   │  │      characters: charactersText,                                           │  │  │
│   │  │      scene_content: sceneContent                                           │  │  │
│   │  │    },                                                                      │  │  │
│   │  │    context: {                                                              │  │  │
│   │  │      name: 'shot-list.scene-3',                                            │  │  │
│   │  │      accountId: 'account-uuid',                                            │  │  │
│   │  │      userId: 'user-uuid'                                                   │  │  │
│   │  │    },                                                                      │  │  │
│   │  │    temperature: 0.4                                                        │  │  │
│   │  │  });                                                                       │  │  │
│   │  │                                                                            │  │  │
│   │  │  // result.data is typed as SceneShotGenerationOutput                      │  │  │
│   │  │  // result.metadata includes { tokens, cost, latency }                     │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Audio Studio Timeline

The Audio Studio handles dialogue generation, voice assignment, and music integration.

```
                              AUDIO STUDIO TIMELINE
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   TIMELINE VIEW (episode duration: 180 seconds)                                         │
│   ────────────────────────────────────────────────────────────────────────────────────  │
│   0s        30s        60s        90s        120s       150s       180s                 │
│   │          │          │          │          │          │          │                   │
│   ▼          ▼          ▼          ▼          ▼          ▼          ▼                   │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  SHOT TRACK                                                                      │  │
│   │  ┌─────────┐┌────────┐┌──────┐┌─────────────┐┌────────┐┌──────────┐┌───────────┐│  │
│   │  │ Shot 1  ││ Shot 2 ││Shot 3││   Shot 4    ││ Shot 5 ││  Shot 6  ││  Shot 7   ││  │
│   │  │  8s     ││  6s    ││ 4s   ││    12s      ││  8s    ││   10s    ││   6s      ││  │
│   │  │ Scene 1 ││ Scene 1││Sc. 1 ││   Scene 2   ││ Scene 2││ Scene 3  ││ Scene 3   ││  │
│   │  └─────────┘└────────┘└──────┘└─────────────┘└────────┘└──────────┘└───────────┘│  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  DIALOGUE TRACK (per character)                                                  │  │
│   │                                                                                  │  │
│   │  Elena:  ┌──────────┐              ┌────────────────┐           ┌──────────┐    │  │
│   │          │ "Hello!" │              │ "What do you   │           │ "Fine."  │    │  │
│   │          │  2.3s    │              │  mean by that?"│           │  0.8s    │    │  │
│   │          │@1.5s     │              │   3.2s @35s    │           │ @142s    │    │  │
│   │          └──────────┘              └────────────────┘           └──────────┘    │  │
│   │                                                                                  │  │
│   │  Marcus:        ┌─────────────┐         ┌─────────────────┐                     │  │
│   │                 │ "I wasn't   │         │ "Let me explain.│                     │  │
│   │                 │  expecting" │         │  It's complex." │                     │  │
│   │                 │  1.8s @8s   │         │  2.9s @52s      │                     │  │
│   │                 └─────────────┘         └─────────────────┘                     │  │
│   │                                                                                  │  │
│   │  Narrator:                                          ┌─────────────────────────┐ │  │
│   │                                                     │ "The tension was        │ │  │
│   │                                                     │  palpable..." 4.1s @120s│ │  │
│   │                                                     └─────────────────────────┘ │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  MUSIC TRACK                                                                     │  │
│   │  ┌────────────────────────────────┐                    ┌────────────────────────┐│  │
│   │  │ 🎵 Ambient Piano               │                    │ 🎵 Tension Build       ││  │
│   │  │    (loop, fade in 3s)          │                    │    (crescendo)         ││  │
│   │  │    Volume: 0.3                 │                    │    Volume: 0.5→0.8     ││  │
│   │  │    0s ───────────────── 90s    │                    │    120s ────────── 180s││  │
│   │  └────────────────────────────────┘                    └────────────────────────┘│  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  SFX TRACK                                                                       │  │
│   │      ┌──┐       ┌────┐                    ┌───────┐              ┌──┐           │  │
│   │      │🚪│       │☕  │                    │ 👣👣  │              │⚡│           │  │
│   │      │  │       │pour│                    │footstp│              │  │           │  │
│   │      └──┘       └────┘                    └───────┘              └──┘           │  │
│   │      @5s        @22s                       @95s                  @155s          │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                         │
│   DATA FLOW:                                                                            │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐         │
│   │  shot_list   │───▶│dialogue_lines│───▶│  TTS Queue   │───▶│ audio_files  │         │
│   │(dialogueTim- │    │   (table)    │    │  (worker)    │    │   (S3/GCS)   │         │
│   │    ing[])    │    │              │    │              │    │              │         │
│   └──────────────┘    └──────────────┘    └──────────────┘    └──────────────┘         │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Database Schema Overview

```
                              DATABASE SCHEMA RELATIONSHIPS
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  CORE TABLES                                                                     │  │
│   │                                                                                  │  │
│   │  ┌───────────────┐         ┌───────────────┐         ┌───────────────┐          │  │
│   │  │   accounts    │◄────────│   projects    │◄────────│   episodes    │          │  │
│   │  ├───────────────┤   1:N   ├───────────────┤   1:N   ├───────────────┤          │  │
│   │  │ id (PK)       │         │ id (PK)       │         │ id (PK)       │          │  │
│   │  │ name          │         │ account_id(FK)│         │ project_id(FK)│          │  │
│   │  │ slug          │         │ name          │         │ title         │          │  │
│   │  │ ...           │         │ ...           │         │ status        │          │  │
│   │  └───────────────┘         └───────────────┘         │ story_data    │◀─ JSONB  │  │
│   │                                                       │ screenplay    │◀─ JSONB  │  │
│   │                                                       │ shot_list     │◀─ JSONB  │  │
│   │                                                       │ ...           │          │  │
│   │                                                       └───────────────┘          │  │
│   │                                                              │                   │  │
│   │                                                              │ 1:N               │  │
│   │                                                              ▼                   │  │
│   │                                                       ┌───────────────┐          │  │
│   │                                                       │    shots      │          │  │
│   │                                                       ├───────────────┤          │  │
│   │                                                       │ id (PK)       │          │  │
│   │                                                       │ episode_id(FK)│          │  │
│   │                                                       │ scene_number  │          │  │
│   │                                                       │ shot_number   │          │  │
│   │                                                       │ description   │          │  │
│   │                                                       │ prompt        │          │  │
│   │                                                       │ duration_secs │          │  │
│   │                                                       │ camera_dir    │          │  │
│   │                                                       │ status        │          │  │
│   │                                                       │ video_url     │          │  │
│   │                                                       │ metadata      │◀─ JSONB  │  │
│   │                                                       └───────────────┘          │  │
│   │                                                              │                   │  │
│   │                                                              │ 1:N               │  │
│   │                                                              ▼                   │  │
│   │                                                       ┌───────────────┐          │  │
│   │                                                       │dialogue_lines │          │  │
│   │                                                       ├───────────────┤          │  │
│   │                                                       │ id (PK)       │          │  │
│   │                                                       │ shot_id (FK)  │          │  │
│   │                                                       │ character_name│          │  │
│   │                                                       │ text          │          │  │
│   │                                                       │ emotion       │          │  │
│   │                                                       │ start_time    │          │  │
│   │                                                       │ duration      │          │  │
│   │                                                       │ audio_url     │          │  │
│   │                                                       │ voice_id      │          │  │
│   │                                                       └───────────────┘          │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  ANALYTICS TABLES                                                                │  │
│   │                                                                                  │  │
│   │  ┌───────────────────────┐              ┌───────────────────────┐               │  │
│   │  │  llm_usage_analytics  │              │  content_analytics    │               │  │
│   │  ├───────────────────────┤              ├───────────────────────┤               │  │
│   │  │ id (PK)               │              │ id (PK)               │               │  │
│   │  │ account_id (FK)       │              │ episode_id (FK)       │               │  │
│   │  │ template_slug         │              │ platform              │               │  │
│   │  │ tokens_used           │              │ views, likes, shares  │               │  │
│   │  │ cost                  │              │ engagement_rate       │               │  │
│   │  │ latency_ms            │              │ fetched_at            │               │  │
│   │  │ success               │              │ ...                   │               │  │
│   │  │ created_at            │              └───────────────────────┘               │  │
│   │  └───────────────────────┘                                                       │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Context Builder System

The context builder system optimizes LLM token usage by filtering global context to only scene-relevant entities.

```
                              CONTEXT BUILDER FUNCTIONS
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  buildGlobalShotContext(episodeId): GlobalShotContext                            │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │  Loads all data needed for shot generation ONCE per episode:                     │  │
│   │                                                                                  │  │
│   │  • Fetches episode with story_data                                               │  │
│   │  • Extracts character registry from story_data.characters                        │  │
│   │  • Fetches location registry from project settings or story_data                 │  │
│   │  • Loads character/location reference images from asset library                  │  │
│   │  • Builds episode metadata (title, genre, duration, style)                       │  │
│   │                                                                                  │  │
│   │  This is called ONCE at the start of shot generation.                            │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  filterContextForScene(scene, globalContext): SceneFilteredContext               │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │  Reduces context to ONLY entities appearing in this specific scene:              │  │
│   │                                                                                  │  │
│   │  Input Scene:                          Filtered Output:                          │  │
│   │  ┌──────────────────────────┐          ┌──────────────────────────┐             │  │
│   │  │ Scene 3: INT. KITCHEN    │          │ SceneFilteredContext {   │             │  │
│   │  │                          │          │   characters: [          │             │  │
│   │  │ ELENA enters, followed   │   ───▶   │     Elena,               │             │  │
│   │  │ by MARCUS.               │          │     Marcus               │             │  │
│   │  │                          │          │   ],                     │             │  │
│   │  │ ELENA: "We need to talk" │          │   locations: [           │             │  │
│   │  │ MARCUS: "I know."        │          │     Kitchen              │             │  │
│   │  └──────────────────────────┘          │   ],                     │             │  │
│   │                                         │   episodeMetadata: {...} │             │  │
│   │  Global Context (12 chars, 8 locs)      │ }                        │             │  │
│   │  ┌──────────────────────────┐          │                          │             │  │
│   │  │ • Elena                  │          │ TOKEN SAVINGS: ~75%      │             │  │
│   │  │ • Marcus                 │          └──────────────────────────┘             │  │
│   │  │ • Sofia                  │                                                    │  │
│   │  │ • David                  │                                                    │  │
│   │  │ • Narrator               │                                                    │  │
│   │  │ • Kitchen                │                                                    │  │
│   │  │ • Living Room            │                                                    │  │
│   │  │ • Office                 │                                                    │  │
│   │  │ • ...8 more              │                                                    │  │
│   │  └──────────────────────────┘                                                    │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  extractSceneCharacters(scene): string[]                                         │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │  Extracts character names from:                                                  │  │
│   │  • scene.dialogue[].character - Direct dialogue attribution                      │  │
│   │  • scene.description - Character names in action lines                           │  │
│   │  • Uses NLP-style extraction for uppercase names                                 │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  formatFilteredCharactersForPrompt(context): string                              │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │  Formats filtered characters for LLM prompt with VEO-optimized descriptions:    │  │
│   │                                                                                  │  │
│   │  Output Format:                                                                  │  │
│   │  ┌──────────────────────────────────────────────────────────────────────────┐   │  │
│   │  │  CHARACTER REGISTRY (Scene-Relevant):                                    │   │  │
│   │  │                                                                          │   │  │
│   │  │  1. ELENA (Protagonist)                                                  │   │  │
│   │  │     Physical: 35-year-old Hispanic woman, long curly black hair,         │   │  │
│   │  │               warm brown eyes, athletic build                            │   │  │
│   │  │     Personality: Determined, empathetic, quick-witted                    │   │  │
│   │  │     Reference Image: [URL if available]                                  │   │  │
│   │  │                                                                          │   │  │
│   │  │  2. MARCUS (Supporting)                                                  │   │  │
│   │  │     Physical: 40-year-old Caucasian man, salt-and-pepper hair,           │   │  │
│   │  │               blue eyes, tall and lean                                   │   │  │
│   │  │     Personality: Reserved, analytical, secretly caring                   │   │  │
│   │  │     Reference Image: [URL if available]                                  │   │  │
│   │  └──────────────────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  formatSceneForPrompt(scene): string                                             │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │  Formats screenplay scene for LLM processing:                                    │  │
│   │                                                                                  │  │
│   │  Output Format:                                                                  │  │
│   │  ┌──────────────────────────────────────────────────────────────────────────┐   │  │
│   │  │  === SCENE 3 ===                                                         │   │  │
│   │  │  INT. KITCHEN - NIGHT                                                    │   │  │
│   │  │                                                                          │   │  │
│   │  │  DESCRIPTION:                                                            │   │  │
│   │  │  Elena enters the dimly lit kitchen, her footsteps echoing...            │   │  │
│   │  │                                                                          │   │  │
│   │  │  DIALOGUE:                                                               │   │  │
│   │  │  ELENA: We need to talk about what happened.                             │   │  │
│   │  │  MARCUS: (sighs) I know. I've been dreading this moment.                 │   │  │
│   │  │                                                                          │   │  │
│   │  │  ESTIMATED DURATION: 45 seconds                                          │   │  │
│   │  └──────────────────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Duration-Based Content Scaling

Content length and structure scale based on target duration and content style.

```
                              DURATION-BASED CONTENT SCALING
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  CONTENT STYLE OPTIONS                                                           │  │
│   │                                                                                  │  │
│   │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐               │  │
│   │  │  dialogue-heavy  │  │     balanced     │  │   action-heavy   │               │  │
│   │  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤               │  │
│   │  │ Dialogue: 70%    │  │ Dialogue: 50%    │  │ Dialogue: 30%    │               │  │
│   │  │ Action: 30%      │  │ Action: 50%      │  │ Action: 70%      │               │  │
│   │  │ Longer scenes    │  │ Mixed pacing     │  │ Quick cuts       │               │  │
│   │  │ Character focus  │  │ Variety          │  │ Visual focus     │               │  │
│   │  └──────────────────┘  └──────────────────┘  └──────────────────┘               │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  DURATION PRESETS                                                                │  │
│   │                                                                                  │  │
│   │  Duration    │ Scenes │ Shots/Scene │ Words/Scene │ Dialogue Lines              │  │
│   │  ────────────┼────────┼─────────────┼─────────────┼─────────────────            │  │
│   │  30 seconds  │   2-3  │    2-3      │   50-100    │     3-5                     │  │
│   │  1 minute    │   3-5  │    3-4      │   100-200   │     6-10                    │  │
│   │  2 minutes   │   5-8  │    3-5      │   200-400   │     12-20                   │  │
│   │  5 minutes   │  10-15 │    4-6      │   400-800   │     30-50                   │  │
│   │  10 minutes  │  15-25 │    4-6      │   800-1500  │     60-100                  │  │
│   │  20 minutes  │  25-40 │    5-7      │  1500-3000  │    120-200                  │  │
│   │                                                                                  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  calculateContentScaling(targetDuration, contentStyle): ContentScaling          │  │
│   │  ──────────────────────────────────────────────────────────────────────────────  │  │
│   │                                                                                  │  │
│   │  Input:                              Output:                                     │  │
│   │  ┌────────────────────────┐          ┌────────────────────────────┐             │  │
│   │  │ targetDuration: 120    │          │ ContentScaling {           │             │  │
│   │  │ contentStyle:          │   ───▶   │   sceneCount: 5-8,         │             │  │
│   │  │   'dialogue-heavy'     │          │   shotsPerScene: 3-5,      │             │  │
│   │  │                        │          │   avgShotDuration: 4-8s,   │             │  │
│   │  └────────────────────────┘          │   dialogueDensity: 0.7,    │             │  │
│   │                                       │   actionDensity: 0.3,      │             │  │
│   │                                       │   wordsPerScene: 200-400,  │             │  │
│   │                                       │   dialogueLines: 12-20     │             │  │
│   │                                       │ }                          │             │  │
│   │                                       └────────────────────────────┘             │  │
│   │                                                                                  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  USAGE IN STORY GENERATION                                                       │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  // In story-generation.json prompt template                              │  │  │
│   │  │  "user_prompt": "Generate a story with the following scaling:             │  │  │
│   │  │    Target Duration: {{target_duration}} seconds                           │  │  │
│   │  │    Scene Count: {{scene_count}} scenes                                    │  │  │
│   │  │    Dialogue Density: {{dialogue_density}}                                 │  │  │
│   │  │    ...                                                                    │  │  │
│   │  │  "                                                                        │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## SCORE Framework

SCORE (Series Continuity and Recall Engine) maintains narrative consistency across episodes.

```
                              SCORE FRAMEWORK
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│   SERIES CONTINUITY AND RECALL ENGINE                                                   │
│   ────────────────────────────────────────────────────────────────────────────────────  │
│                                                                                         │
│   Purpose: Maintain narrative consistency across multiple episodes in a series          │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  SCORE FIELDS (stored in story_data)                                             │  │
│   │                                                                                  │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  episodeSummary: string                                                    │  │  │
│   │  │  ──────────────────────────────────────────────────────────────────────   │  │  │
│   │  │  2-3 sentence summary of episode events for next episode context.         │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example: "Elena discovered the hidden letter in Marcus's office,          │  │  │
│   │  │  leading to a confrontation about their shared past. The episode           │  │  │
│   │  │  ended with Elena leaving town, promising to return with answers."         │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                                  │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  sentimentScore: number (-1 to 1)                                          │  │  │
│   │  │  ──────────────────────────────────────────────────────────────────────   │  │  │
│   │  │  Emotional arc tracking for series mood progression.                       │  │  │
│   │  │                                                                            │  │  │
│   │  │  -1.0 ◄─────────────────┼─────────────────► +1.0                           │  │  │
│   │  │  Dark/Tragic      Neutral/Mixed      Hopeful/Triumphant                    │  │  │
│   │  │                                                                            │  │  │
│   │  │  Used to: Ensure emotional variety across series, avoid monotony           │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                                  │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  keyEvents: string[]                                                       │  │  │
│   │  │  ──────────────────────────────────────────────────────────────────────   │  │  │
│   │  │  Major plot points that affect future episodes.                            │  │  │
│   │  │                                                                            │  │  │
│   │  │  Example:                                                                  │  │  │
│   │  │  [                                                                         │  │  │
│   │  │    "Elena found the hidden letter",                                        │  │  │
│   │  │    "Marcus revealed his true identity",                                    │  │  │
│   │  │    "The mysterious stranger appeared at the cafe"                          │  │  │
│   │  │  ]                                                                         │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   │                                                                                  │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  characterGrowth: Record<string, CharacterState>                           │  │  │
│   │  │  ──────────────────────────────────────────────────────────────────────   │  │  │
│   │  │  Tracks character development across episodes.                             │  │  │
│   │  │                                                                            │  │  │
│   │  │  {                                                                         │  │  │
│   │  │    "Elena": {                                                              │  │  │
│   │  │      "currentState": "Determined to uncover the truth",                    │  │  │
│   │  │      "relationships": {                                                    │  │  │
│   │  │        "Marcus": "Strained but hopeful",                                   │  │  │
│   │  │        "Sofia": "Close confidant"                                          │  │  │
│   │  │      },                                                                    │  │  │
│   │  │      "knowledge": ["knows about the letter", "suspects Marcus's secret"]   │  │  │
│   │  │    }                                                                       │  │  │
│   │  │  }                                                                         │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐  │
│   │  SCORE FLOW BETWEEN EPISODES                                                     │  │
│   │                                                                                  │  │
│   │  ┌─────────────┐     SCORE Context      ┌─────────────┐     SCORE Context       │  │
│   │  │ Episode 1   │ ────────────────────▶  │ Episode 2   │ ──────────────────▶ ... │  │
│   │  │             │                         │             │                         │  │
│   │  │ story_data: │                         │ story_data: │                         │  │
│   │  │ • summary   │                         │ Receives:   │                         │  │
│   │  │ • sentiment │                         │ • E1 summary│                         │  │
│   │  │ • keyEvents │                         │ • E1 events │                         │  │
│   │  │ • charGrowth│                         │ • E1 chars  │                         │  │
│   │  └─────────────┘                         └─────────────┘                         │  │
│   │                                                                                  │  │
│   │  Usage in story-generation prompt:                                               │  │
│   │  ┌───────────────────────────────────────────────────────────────────────────┐  │  │
│   │  │  "Previous Episode Context:                                                │  │  │
│   │  │   Summary: {{previous_episode_summary}}                                    │  │  │
│   │  │   Key Events: {{previous_key_events}}                                      │  │  │
│   │  │   Character States: {{previous_character_states}}                          │  │  │
│   │  │                                                                            │  │  │
│   │  │   Generate the next episode maintaining continuity with the above..."      │  │  │
│   │  └───────────────────────────────────────────────────────────────────────────┘  │  │
│   └─────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### Key Files

| Component | File Location |
|-----------|---------------|
| Shot List Generation | `packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts` |
| Context Builder | `packages/features/episodes/src/server/context-builder.ts` |
| Shot Schemas | `packages/features/episodes/src/lib/schemas/shot-list.schema.ts` |
| Types | `packages/features/episodes/src/lib/types.ts` |
| Duration Scaling | `packages/features/episodes/src/lib/duration-scaling.ts` |
| Scene Shot Prompt | `packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json` |
| Story Generation Prompt | `packages/features/prompt-engine/src/prompts/story-generation/story-generation.json` |

### Key Functions

| Function | Purpose |
|----------|---------|
| `generateShotListAction()` | Main entry point for shot generation |
| `buildGlobalShotContext()` | Build once, use for all scenes |
| `filterContextForScene()` | 50-80% token savings per scene |
| `aggregateSceneResults()` | Combine scene results with sequencing |
| `executeLLM()` | Type-safe prompt execution |
| `calculateContentScaling()` | Duration-based content parameters |

### Data Flow Summary

```
User Input → Ideation → Story (story_data) → Screenplay (screenplay_data)
          → Visual Studio (shot_list + shots table) → Audio Studio (dialogue_lines)
```
