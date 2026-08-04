# Episodes & Content Generation

A multi-stage AI-powered pipeline for generating video content. Moved here from the root `CLAUDE.md` so it loads only when working in this package.

## Episode Workflow

```
┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌───────────────┐    ┌──────────────┐
│  Ideation   │───▶│    Story    │───▶│  Screenplay  │───▶│ Visual Studio │───▶│ Audio Studio │
│ (concepts)  │    │ (narrative) │    │  (scenes)    │    │   (shots)     │    │  (timeline)  │
└─────────────┘    └─────────────┘    └──────────────┘    └───────────────┘    └──────────────┘
```

**Studio Routes**: `apps/web/app/home/[account]/studio/[projectId]/episodes/[episodeId]/`
- `/ideation` - Concept and idea generation with duration selector
- `/story` - AI-powered story authoring
- `/screenplay` - Scene-by-scene screenplay format
- `/visual-studio` - Shot list with VEO 3.1 optimized prompts
- `/audio-studio` - Dialogue timeline and music tracks

## Key Packages

| Package | Purpose |
|---------|---------|
| `@kit/episodes` | Episode management, story generation, shot lists |
| `@kit/prompt-engine` | JSON-based LLM prompt templates |
| `@kit/content-analytics` | Platform performance insights |
| `@kit/audio-generation` | TTS and music generation |

## Scene-by-Scene Shot Generation

Shot lists are generated using a scalable scene-by-scene pipeline (not monolithic):

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│   1. BUILD GLOBAL CONTEXT (once)                                                │
│      buildGlobalShotContext() → Character Registry + Location Registry          │
├─────────────────────────────────────────────────────────────────────────────────┤
│   2. FOR EACH SCENE:                                                            │
│      filterContextForScene() → Extract only scene-relevant characters/locations │
│      executeLLM('scene-shot-generation') → Generate VEO 3.1 shots               │
│      Result: 50-80% TOKEN SAVINGS per scene                                     │
├─────────────────────────────────────────────────────────────────────────────────┤
│   3. AGGREGATE RESULTS                                                          │
│      aggregateSceneResults() → Assign global sequence numbers                   │
│      batchCreateShotsAction() → Store in shots table                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

**Key files**:
- `packages/features/episodes/src/server/context-builder.ts` - Context building and filtering
- `packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts` - Shot generation
- `packages/features/prompt-engine/src/prompts/story-generation/scene-shot-generation.json`

## VEO 3.1 Prompt Structure

Each shot generates a 7-component VEO 3.1 optimized prompt:

| Component | Description |
|-----------|-------------|
| Subject | 15+ character attributes (age, ethnicity, hair, eyes, build) |
| Action | Movements, gestures, timing, micro-expressions |
| Scene | Environment, props, lighting, weather |
| Style | Camera shot, angle, movement, aesthetic |
| Dialogue | `"[Name]: 'text' (Tone: emotion)"` - colon syntax prevents subtitles |
| Sounds | Ambient + effects (prevents audio hallucinations) |
| Negative | Exclude subtitles, captions, watermarks |

## Duration-Based Scaling

Content requirements scale automatically based on target duration:

```typescript
import { calculateContentScaling } from '@kit/episodes';

const scaling = calculateContentScaling({
  targetDurationSeconds: 300, // 5 minutes
  contentStyle: 'dialogue-heavy', // or 'balanced', 'action-heavy'
});
// Returns: ~750 words, ~7 scenes, ~40 dialogue lines, ~43 shots
```

## SCORE Framework

Episode continuity across a series:
- `episodeSummary` - 2-3 sentence plot summary
- `sentimentScore` - Emotional tone (0-1)
- `keyEvents` - Major plot points affecting future episodes

See `packages/features/episodes/README.md` for complete documentation.
