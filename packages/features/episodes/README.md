# @kit/episodes

Episode management and content generation package for the Film Studio platform. Handles the complete content creation pipeline from story ideation to final shot generation.

## Overview

This package provides:
- Multi-stage episode workflow (ideation → story → screenplay → visual studio → audio studio)
- AI-powered story and screenplay generation
- VEO 3.1 optimized shot list generation with scene-by-scene processing
- Duration-based content scaling
- SCORE framework for episode continuity

## Episode Workflow Pipeline

```
                              EPISODE WORKFLOW PIPELINE
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                         │
│  ┌───────────────┐                                                                      │
│  │   IDEATION    │  User provides: title, concept, genre, target audience              │
│  │  /ideation    │                                                                      │
│  └───────┬───────┘                                                                      │
│          │                                                                              │
│          ▼                                                                              │
│  ┌───────────────┐  ┌─────────────────────────────────────────────────────────────┐    │
│  │    STORY      │  │  story_data (JSONB)                                         │    │
│  │    /story     │──│  ├── title, logline, premise, fullStory                     │    │
│  │               │  │  ├── actBreakdown { act1, act2, act3 }                      │    │
│  └───────┬───────┘  │  ├── characters [{ name, role, arc }]                       │    │
│          │          │  └── SCORE: episodeSummary, sentimentScore, keyEvents       │    │
│          │          └─────────────────────────────────────────────────────────────┘    │
│          ▼                                                                              │
│  ┌───────────────┐  ┌─────────────────────────────────────────────────────────────┐    │
│  │  SCREENPLAY   │  │  screenplay_data (JSONB)                                    │    │
│  │  /screenplay  │──│  ├── scenes: [{ number, heading, location, timeOfDay,       │    │
│  │               │  │  │     description, dialogue, estimatedDuration }]          │    │
│  └───────┬───────┘  │  └── metadata: { totalScenes, estimatedDuration }           │    │
│          │          └─────────────────────────────────────────────────────────────┘    │
│          ▼                                                                              │
│  ┌───────────────┐  ┌─────────────────────────────────────────────────────────────┐    │
│  │ VISUAL STUDIO │  │  shot_list (JSONB) + shots table                            │    │
│  │ /visual-studio│──│  ├── shots: [{ sequenceNumber, veoPrompt, dialogueTiming }] │    │
│  │               │  │  └── metadata: { totalShots, referenceImages }              │    │
│  └───────┬───────┘  └─────────────────────────────────────────────────────────────┘    │
│          ▼                                                                              │
│  ┌───────────────┐  ┌─────────────────────────────────────────────────────────────┐    │
│  │ AUDIO STUDIO  │  │  dialogue_lines + episode_music tables                      │    │
│  │ /audio-studio │──│  ├── Timeline visualization, Character voice assignments    │    │
│  │               │  │  └── Music tracks, TTS generation queue                     │    │
│  └───────────────┘  └─────────────────────────────────────────────────────────────┘    │
│                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Structures

### Episode

```typescript
interface Episode {
  id: string;
  projectId: string;
  seasonId: string | null;
  number: number;
  title: string;
  description: string | null;
  status: EpisodeStatus;
  durationSeconds: number | null;
  storyData: StoryData | null;
  screenplayData: ScreenplayData | null;
  shotList: ShotListData | null;
  metadata: EpisodeMetadata | null;
  version: number;
}

type EpisodeStatus = 'draft' | 'story' | 'storyboard' | 'generating' | 'editing' | 'ready' | 'published';
```

### StoryData

```typescript
interface StoryData {
  // Core content
  title?: string;
  logline?: string;
  premise?: string;
  fullStory?: string;

  // Structure
  actBreakdown?: {
    act1: string;
    act2: string;
    act3: string;
  };
  characters?: StoryCharacterArc[];
  themes?: string[];
  tone?: string;
  estimatedSceneCount?: number;

  // Generation settings (persisted for downstream)
  targetDuration?: number;
  contentStyle?: ContentStyle;
  genre?: string;

  // SCORE Framework (episode continuity)
  episodeSummary?: string;    // 2-3 sentence plot summary
  sentimentScore?: number;    // 0-1 emotional tone
  keyEvents?: string[];       // Major plot points
}
```

### ScreenplayData

```typescript
interface ScreenplayData {
  scenes: ScreenplayScene[];
  metadata: ScreenplayMetadataSummary;
  generatedAt?: string;
  approvedAt?: string;
}

interface ScreenplayScene {
  number: number;
  heading: string;
  location: string;
  timeOfDay: 'day' | 'night' | 'dawn' | 'dusk';
  description: string;
  dialogue: ScreenplayDialogueLine[];
  estimatedDuration: number;
}
```

### ShotListData

```typescript
interface ShotListData {
  shots?: Array<{
    sequenceNumber: number;
    sceneNumber: number;
    duration: number;
    sceneDescription: string;
    actionDescription: string;
    prompt: string;
    cameraDirection: string;
    characters: string[];
    veoPrompt?: VeoPromptData;
    dialogueTiming?: ShotDialogueTimingData[];
  }>;
  generatedAt?: string;
  totalEstimatedDuration?: number;
  metadata?: {
    totalShots: number;
    shotTypes: { wide: number; medium: number; closeUp: number };
    processingMethod?: 'scene-by-scene' | 'monolithic';
    referenceImages?: { characters: ReferenceImageData[]; locations: ReferenceImageData[] };
  };
}
```

## Server Actions

### Story Generation

```typescript
import { generateStoryAction } from '@kit/episodes/server';

const result = await generateStoryAction({
  episodeId: 'uuid',
  targetDurationSeconds: 300, // 5 minutes
  contentStyle: 'dialogue-heavy',
});
// Returns: { success: true, story: StoryData }
```

### Screenplay Conversion

```typescript
import { convertToScreenplayAction } from '@kit/episodes/server';

const result = await convertToScreenplayAction({
  episodeId: 'uuid',
});
// Returns: { success: true, screenplay: ScreenplayData }
```

### Shot List Generation

```typescript
import { generateShotListAction } from '@kit/episodes/server';

const result = await generateShotListAction({
  episodeId: 'uuid',
  shotDurationMin: 5,
  shotDurationMax: 8, // every shot is kept between these (KB-120)
});
// Returns: { success: true, shots: GeneratedShot[], metadata: {...} }
```

## Scene-by-Scene Shot Generation

Shots are generated one scene at a time, in parallel. `generateShotListAction`
(and the bulk actions) queue a `shot-generation` job; the LLM worker runs it:

```
processShotGeneration            apps/web/lambda/llm-worker/handlers/shot-generation.ts
  buildEpisodeContext() → formatCharactersForVeoPrompt() / formatLocationsForVeoPrompt()
  runShotOrchestrator()          src/agent/shot-orchestrator.ts
    Reel Scout     analyzeScenes        short-form candidate scenes
    Shot Director  generateShots        src/agent/skills/shot-director-skill.ts
                   executeLLM('scene-shot-generation') once per scene,
                   in parallel batches of 5 (3 when there are more than 15 scenes),
                   Promise.allSettled per batch; shots numbered in order
    Shot Quality   evaluateShotQuality  post-generation quality gate
  replaces the episode's rows in the shots table
```

Every scene prompt carries the episode's full character and location
context. The older in-process pipeline (`buildGlobalShotContext`,
`filterContextForScene`, `aggregateSceneResults`) was replaced by this job
in `e2d42522`; its leftover copy was deleted in KB-122.

## VEO 3.1 Integration

Shot prompts are optimized for Google VEO 3.1 using the 7-component format:

```
                              VEO 3.1 PROMPT STRUCTURE

┌─────────────────────────────────────────────────────────────────────────────────────┐
│   veoPrompt {                                                                       │
│   ┌─────────────────────────────────────────────────────────────────────────────┐  │
│   │ 1. SUBJECT: 15+ character attributes (age, ethnicity, hair, eyes, build)    │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 2. ACTION: Movements, gestures, timing, micro-expressions, body language    │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 3. SCENE: Environment, props, lighting, weather, time of day                │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 4. STYLE: Camera shot, angle, movement, lighting style, color palette       │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 5. DIALOGUE: "[Character]: 'text' (Tone: emotion)" - colon syntax           │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 6. SOUNDS: Ambient + effects (prevents audio hallucinations)                │  │
│   ├─────────────────────────────────────────────────────────────────────────────┤  │
│   │ 7. NEGATIVE: Exclude subtitles, captions, watermarks, text overlays         │  │
│   └─────────────────────────────────────────────────────────────────────────────┘  │
│   }                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### VEO Prompt Structure

```typescript
interface VeoPromptData {
  subject: string;        // 15+ character attributes
  action: string;         // Movements, gestures
  scene: string;          // Environment description
  style: string;          // Camera, angle, aesthetic
  dialogue?: string;      // "[Name]: 'text' (Tone: emotion)"
  sounds: string;         // Ambient audio
  negativePrompt: string; // What to exclude
  fullPrompt: string;     // Combined copy-ready prompt
}
```

### Reference Images

```typescript
// Extract reference images for VEO "Ingredients"
const images = extractReferenceImages(episodeContext);
// Returns:
// {
//   characters: [{ name: 'Maya', url: 'https://...' }],
//   locations: [{ name: 'Office', url: 'https://...' }],
//   missingCharacters: ['Bob'],
//   missingLocations: []
// }
```

## Duration-Based Content Scaling

Content requirements scale automatically based on target duration:

```typescript
import { calculateContentScaling } from '@kit/episodes';

const scaling = calculateContentScaling({
  targetDurationSeconds: 300, // 5 minutes
  contentStyle: 'dialogue-heavy',
});

// Returns:
// {
//   story: { wordCountMin: 600, wordCountMax: 900 },
//   screenplay: {
//     sceneCountMin: 6, sceneCountMax: 8,
//     totalDialogueLinesMin: 33, totalDialogueLinesMax: 50
//   },
//   shots: { totalShotsMin: 34, totalShotsMax: 51 }
// }
```

### Content Styles

| Style | Dialogue Multiplier | Use Case |
|-------|---------------------|----------|
| `dialogue-heavy` | 1.5x | Kids' cartoons, comedies |
| `balanced` | 1.0x | General content |
| `action-heavy` | 0.5x | Action sequences |

### Duration Presets

```typescript
const DURATION_PRESETS = [
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
  { label: '30 minutes', value: 1800 },
  { label: '1 hour', value: 3600 },
  { label: '2 hours', value: 7200 },
];
```

## SCORE Framework

Episode continuity across a series using the SCORE framework:

| Field | Type | Purpose |
|-------|------|---------|
| `episodeSummary` | string | 2-3 sentence plot summary |
| `sentimentScore` | number (0-1) | Emotional tone of episode |
| `keyEvents` | string[] | Major plot points affecting future episodes |

### Continuity in Story Generation

```typescript
// Previous episodes are fetched for context
const context = await buildEpisodeContext(episodeId);

context.previousEpisodes.forEach(ep => {
  console.log(ep.summary);      // Plot summary
  console.log(ep.keyEvents);    // Key events to reference
  console.log(ep.sentimentScore); // Emotional tone
});
```

## Components

### Story Studio

Main story authoring interface with AI generation.

```typescript
import { StoryStudio } from '@kit/episodes/components';

<StoryStudio
  episode={episode}
  projectSlug={projectSlug}
  accountSlug={accountSlug}
/>
```

### Story Ideation

Concept and idea generation with duration selector.

```typescript
import { StoryIdeation } from '@kit/episodes/components';

<StoryIdeation
  episode={episode}
  projectSlug={projectSlug}
  accountSlug={accountSlug}
/>
```

### Duration Selector

Target duration picker with scaling preview.

```typescript
import { DurationSelector } from '@kit/episodes/components';

<DurationSelector
  value={300}
  onChange={(seconds) => setDuration(seconds)}
  contentStyle="dialogue-heavy"
/>
```

## File Structure

```
packages/features/episodes/
├── src/
│   ├── components/          # React components
│   │   ├── story-studio/
│   │   ├── story-ideation/
│   │   ├── duration-selector.tsx
│   │   └── index.ts
│   ├── lib/
│   │   ├── types.ts         # Core type definitions
│   │   ├── duration-scaling.ts
│   │   ├── schemas/         # Zod schemas
│   │   │   ├── story.schema.ts
│   │   │   ├── screenplay.schema.ts
│   │   │   └── shot-list.schema.ts
│   │   └── server/
│   │       └── mutations/
│   │           ├── story-actions.ts
│   │           ├── screenplay-actions.ts
│   │           └── shot-list-actions.ts
│   └── server/
│       ├── context-builder.ts  # Episode context for prompts
│       └── index.ts
└── package.json
```

## Prompt Templates

This package uses JSON prompt templates from `@kit/prompt-engine`:

| Template | Purpose |
|----------|---------|
| `story-generation.json` | Story → full narrative |
| `screenplay-conversion.json` | Story → formatted scenes |
| `scene-shot-generation.json` | Scene → VEO shots (scalable) |
| `season-generation.json` | Season → episode outlines |

See `packages/features/prompt-engine/CLAUDE.md` for prompt template documentation.

## Related Packages

- `@kit/prompt-engine` - JSON-based LLM prompt management
- `@kit/llm` - LLM provider abstraction
- `@kit/audio-generation` - TTS and music generation
