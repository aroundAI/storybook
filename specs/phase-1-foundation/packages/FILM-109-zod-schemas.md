# FILM-109 Zod Schemas Package

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** M
- **Dependencies:** None
- **Blocks:** All Phase 2-5 features
- **Status:** ✅ Complete
- **Implemented:** 2025-12-07
- **PR:** [#17](https://github.com/aroundAI/storybook/pull/17)

## Context
This task consolidates all Zod validation schemas into a centralized @kit/film-studio-schemas package. Having a single source of truth for schemas ensures consistency across the application, enables easy schema reuse, and provides compile-time type safety for all data validation. This package will be consumed by all other Film Studio packages.

## Specification

### Package Structure
```
packages/features/film-studio-schemas/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── project.ts
    ├── asset.ts
    ├── episode.ts
    ├── shot.ts
    ├── video.ts
    ├── audio.ts
    └── common.ts
```

### package.json
```json
{
  "name": "@kit/film-studio-schemas",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "clean": "rimraf dist",
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit"
  },
  "exports": {
    ".": "./src/index.ts",
    "./project": "./src/project.ts",
    "./asset": "./src/asset.ts",
    "./episode": "./src/episode.ts",
    "./shot": "./src/shot.ts",
    "./video": "./src/video.ts",
    "./audio": "./src/audio.ts",
    "./common": "./src/common.ts"
  },
  "dependencies": {
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.3.0",
    "tsup": "^8.0.0",
    "rimraf": "^5.0.0"
  }
}
```

### tsconfig.json
```json
{
  "extends": "../../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Exports
| Export Path | Description |
|-------------|-------------|
| `.` | Main exports (re-exports all schemas) |
| `./project` | Project and studio settings schemas |
| `./asset` | Asset, character, location schemas |
| `./episode` | Episode and scene schemas |
| `./shot` | Shot and camera schemas |
| `./video` | Video generation schemas |
| `./audio` | Audio generation schemas |
| `./common` | Common/shared schemas |

### Dependencies
| Package | Purpose |
|---------|---------|
| zod | Schema validation library |

### Schema Files

#### src/index.ts
```typescript
// Re-export all schemas
export * from './common';
export * from './project';
export * from './asset';
export * from './episode';
export * from './shot';
export * from './video';
export * from './audio';
```

#### src/common.ts
```typescript
import { z } from 'zod';

// Common enums and types
export const UUIDSchema = z.string().uuid();
export const URLSchema = z.string().url();
export const EmailSchema = z.string().email();

export const TimestampSchema = z.string().datetime();

export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().optional(),
});

export const SortOrderSchema = z.enum(['asc', 'desc']);

export const MetadataSchema = z.record(z.unknown());
```

#### src/project.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, MetadataSchema } from './common';

// Project Type
export const ProjectTypeSchema = z.enum(['short-film', 'series', 'documentary', 'ad', 'educational']);

// Target Platforms
export const TargetPlatformSchema = z.enum(['youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin', 'custom']);

// Video Style
export const VideoStyleSchema = z.enum([
  'realistic',
  'animated',
  'cartoon',
  'anime',
  'cinematic',
  'documentary',
  'vlog',
  'commercial',
]);

// Studio Project Settings
export const StudioProjectSettingsSchema = z.object({
  projectType: ProjectTypeSchema,
  targetPlatforms: z.array(TargetPlatformSchema).min(1),
  videoStyle: VideoStyleSchema,
  defaultAspectRatio: z.string().regex(/^\d+:\d+$/).default('16:9'),
  defaultDuration: z.number().positive().default(5),
  defaultProvider: z.enum(['kling', 'runway', 'luma']).default('kling'),
  audioProvider: z.enum(['elevenlabs', 'suno']).optional(),
  targetAudience: z.string().optional(),
  contentRating: z.enum(['G', 'PG', 'PG-13', 'R', 'NR']).optional(),
  language: z.string().default('en'),
  subtitlesEnabled: z.boolean().default(false),
});

export type StudioProjectSettings = z.infer<typeof StudioProjectSettingsSchema>;

// Project CRUD
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  settings: StudioProjectSettingsSchema.optional(),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  id: UUIDSchema,
});
```

#### src/asset.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, URLSchema, MetadataSchema } from './common';

// Asset Type
export const AssetTypeSchema = z.enum(['character', 'location', 'prop']);

// Physical Attributes
export const PhysicalAttributesSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  build: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  skinTone: z.string().optional(),
  distinctiveFeatures: z.string().optional(),
});

// Voice Settings
export const VoiceSettingsSchema = z.object({
  voiceId: z.string().optional(),
  provider: z.enum(['elevenlabs', 'suno']).optional(),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.0),
  useSpeakerBoost: z.boolean().default(true),
});

// Character Metadata
export const CharacterMetadataSchema = z.object({
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: z.string().optional(),
  backstory: z.string().optional(),
  voiceSettings: VoiceSettingsSchema.optional(),
  relationships: z.array(z.object({
    characterId: UUIDSchema,
    relationship: z.string(),
  })).optional(),
});

// Location Metadata
export const LocationMetadataSchema = z.object({
  setting: z.string().optional(),
  timeOfDay: z.enum(['dawn', 'morning', 'afternoon', 'evening', 'night', 'any']).optional(),
  weather: z.enum(['sunny', 'cloudy', 'rainy', 'snowy', 'stormy', 'foggy', 'any']).optional(),
  atmosphere: z.string().optional(),
  lighting: z.string().optional(),
  soundscape: z.string().optional(),
});

// Prop Metadata
export const PropMetadataSchema = z.object({
  category: z.string().optional(),
  dimensions: z.string().optional(),
  material: z.string().optional(),
  color: z.string().optional(),
  significance: z.string().optional(),
});

// Base Asset Schema
export const BaseAssetSchema = z.object({
  projectId: UUIDSchema,
  type: AssetTypeSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: URLSchema.optional(),
  metadata: MetadataSchema.optional(),
});

// Create Asset Schema
export const CreateAssetSchema = BaseAssetSchema;

export const CreateCharacterSchema = BaseAssetSchema.extend({
  type: z.literal('character'),
  metadata: CharacterMetadataSchema.optional(),
});

export const CreateLocationSchema = BaseAssetSchema.extend({
  type: z.literal('location'),
  metadata: LocationMetadataSchema.optional(),
});

export const CreatePropSchema = BaseAssetSchema.extend({
  type: z.literal('prop'),
  metadata: PropMetadataSchema.optional(),
});

// Update Asset Schema
export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdateCharacterSchema = CreateCharacterSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdateLocationSchema = CreateLocationSchema.partial().extend({
  id: UUIDSchema,
});

export const UpdatePropSchema = CreatePropSchema.partial().extend({
  id: UUIDSchema,
});
```

#### src/episode.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, MetadataSchema } from './common';

// Episode Status
export const EpisodeStatusSchema = z.enum([
  'draft',
  'planning',
  'scripting',
  'in_progress',
  'reviewing',
  'completed',
  'published',
  'archived',
]);

// Episode Metadata
export const EpisodeMetadataSchema = z.object({
  sceneCount: z.number().int().nonnegative().optional(),
  shotCount: z.number().int().nonnegative().optional(),
  totalDuration: z.number().nonnegative().optional(),
  themes: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  characters: z.array(UUIDSchema).optional(),
  locations: z.array(UUIDSchema).optional(),
  estimatedCost: z.number().nonnegative().optional(),
  targetAudience: z.string().optional(),
});

// Create Episode
export const CreateEpisodeSchema = z.object({
  projectId: UUIDSchema,
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  episodeNumber: z.number().int().positive(),
  seasonNumber: z.number().int().positive().optional(),
  script: z.string().optional(),
  duration: z.number().positive().optional(),
  metadata: EpisodeMetadataSchema.optional(),
});

// Update Episode
export const UpdateEpisodeSchema = CreateEpisodeSchema.partial().extend({
  id: UUIDSchema,
  status: EpisodeStatusSchema.optional(),
});

// Generate Episode from Prompt
export const GenerateEpisodeFromPromptSchema = z.object({
  projectId: UUIDSchema,
  prompt: z.string().min(10).max(5000),
  episodeNumber: z.number().int().positive(),
  targetDuration: z.number().positive().optional(),
  style: z.string().optional(),
  tone: z.string().optional(),
  includeDialogue: z.boolean().default(true),
});

// Scene Schema
export const SceneSchema = z.object({
  sceneNumber: z.number().int().positive(),
  title: z.string().optional(),
  description: z.string(),
  location: z.string().optional(),
  timeOfDay: z.string().optional(),
  characters: z.array(z.string()).optional(),
  duration: z.number().positive().optional(),
  shots: z.array(z.any()).optional(), // Will be ShotSchema
});
```

#### src/shot.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, URLSchema, MetadataSchema } from './common';

// Shot Status
export const ShotStatusSchema = z.enum([
  'pending',
  'queued',
  'generating',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

// Camera Angle
export const CameraAngleSchema = z.enum([
  'wide',
  'full',
  'medium',
  'medium-close-up',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'pov',
  'low-angle',
  'high-angle',
  'birds-eye',
  'dutch-angle',
  'aerial',
]);

// Camera Movement
export const CameraMovementSchema = z.enum([
  'static',
  'pan-left',
  'pan-right',
  'tilt-up',
  'tilt-down',
  'zoom-in',
  'zoom-out',
  'dolly-in',
  'dolly-out',
  'tracking',
  'crane-up',
  'crane-down',
  'handheld',
  'steadicam',
  'orbit',
]);

// Shot Composition
export const ShotCompositionSchema = z.object({
  framing: z.string().optional(),
  focus: z.string().optional(),
  depth: z.enum(['shallow', 'deep', 'medium']).optional(),
  rule: z.enum(['rule-of-thirds', 'golden-ratio', 'centered', 'symmetrical']).optional(),
});

// Shot Metadata
export const ShotMetadataSchema = z.object({
  characters: z.array(UUIDSchema).optional(),
  locations: z.array(UUIDSchema).optional(),
  props: z.array(UUIDSchema).optional(),
  dialogue: z.string().optional(),
  action: z.string().optional(),
  soundEffects: z.array(z.string()).optional(),
  music: z.string().optional(),
  lighting: z.enum(['natural', 'soft', 'hard', 'dramatic', 'low-key', 'high-key']).optional(),
  mood: z.string().optional(),
  colorGrading: z.string().optional(),
  visualEffects: z.array(z.string()).optional(),
  composition: ShotCompositionSchema.optional(),
});

// Create Shot
export const CreateShotSchema = z.object({
  episodeId: UUIDSchema,
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1),
  duration: z.number().positive().default(5),
  cameraAngle: CameraAngleSchema.optional(),
  cameraMovement: CameraMovementSchema.optional(),
  prompt: z.string().optional(),
  metadata: ShotMetadataSchema.optional(),
});

// Update Shot
export const UpdateShotSchema = CreateShotSchema.partial().extend({
  id: UUIDSchema,
  status: ShotStatusSchema.optional(),
  videoUrl: URLSchema.optional(),
  thumbnailUrl: URLSchema.optional(),
});

// Batch Create Shots
export const BatchCreateShotsSchema = z.object({
  episodeId: UUIDSchema,
  shots: z.array(CreateShotSchema.omit({ episodeId: true })),
});
```

#### src/video.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, URLSchema } from './common';

// Video Provider
export const VideoProviderSchema = z.enum(['kling', 'runway', 'luma']);

// Generation Status
export const GenerationStatusSchema = z.enum([
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

// Aspect Ratio
export const AspectRatioSchema = z.string().regex(/^\d+:\d+$/);

// Video Generation Settings
export const VideoGenerationSettingsSchema = z.object({
  provider: VideoProviderSchema,
  modelVersion: z.string().optional(),
  aspectRatio: AspectRatioSchema.default('16:9'),
  duration: z.number().positive().max(20).default(5),
  seed: z.number().int().positive().optional(),
  negativePrompt: z.string().max(1000).optional(),
  fps: z.number().int().positive().optional(),
  quality: z.enum(['draft', 'standard', 'high']).optional(),
  motionStrength: z.number().min(0).max(1).optional(),
});

// Video Generation Request
export const VideoGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  duration: z.number().positive().max(20),
  aspectRatio: AspectRatioSchema,
  seed: z.number().int().positive().optional(),
  modelVersion: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

// Generate Video
export const GenerateVideoSchema = z.object({
  shotId: UUIDSchema,
  provider: VideoProviderSchema,
  request: VideoGenerationRequestSchema,
});

// Video Generation Job Update
export const UpdateVideoGenerationJobSchema = z.object({
  jobId: UUIDSchema,
  status: GenerationStatusSchema,
  videoUrl: URLSchema.optional(),
  thumbnailUrl: URLSchema.optional(),
  error: z.string().optional(),
  progress: z.number().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Provider-specific schemas
export const KlingGenerationSchema = VideoGenerationRequestSchema.extend({
  mode: z.enum(['standard', 'pro']).optional(),
  negativePrompt: z.string().max(2000).optional(),
});

export const RunwayGenerationSchema = VideoGenerationRequestSchema.extend({
  interpolate: z.boolean().optional(),
  upscale: z.boolean().optional(),
  watermark: z.boolean().default(false),
});

export const LumaGenerationSchema = VideoGenerationRequestSchema.extend({
  loop: z.boolean().optional(),
  keyframes: z.array(z.object({
    frame: z.number().int().nonnegative(),
    prompt: z.string(),
  })).optional(),
});
```

#### src/audio.ts
```typescript
import { z } from 'zod';
import { UUIDSchema, URLSchema } from './common';

// Audio Provider
export const AudioProviderSchema = z.enum(['elevenlabs', 'suno']);

// Audio Type
export const AudioTypeSchema = z.enum(['voice', 'music', 'sfx', 'ambient']);

// Audio Format
export const AudioFormatSchema = z.enum(['mp3', 'wav', 'pcm', 'ogg', 'flac']);

// Voice Settings
export const VoiceGenerationSettingsSchema = z.object({
  voiceId: z.string().min(1),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.0),
  useSpeakerBoost: z.boolean().default(true),
  modelId: z.string().optional(),
  outputFormat: AudioFormatSchema.default('mp3'),
});

// Voice Generation Request
export const VoiceGenerationRequestSchema = z.object({
  text: z.string().min(1).max(5000),
  voiceId: z.string().min(1),
  settings: VoiceGenerationSettingsSchema.partial().optional(),
  modelId: z.string().optional(),
  outputFormat: AudioFormatSchema.optional(),
});

// Music Generation Request
export const MusicGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(1000),
  duration: z.number().positive().max(240), // 4 minutes max
  genre: z.string().optional(),
  mood: z.string().optional(),
  tempo: z.enum(['slow', 'medium', 'fast']).optional(),
  instrumentalOnly: z.boolean().default(true),
  tags: z.array(z.string()).optional(),
});

// Generate Voice
export const GenerateVoiceSchema = z.object({
  shotId: UUIDSchema.optional(),
  episodeId: UUIDSchema.optional(),
  request: VoiceGenerationRequestSchema,
});

// Generate Music
export const GenerateMusicSchema = z.object({
  episodeId: UUIDSchema,
  shotId: UUIDSchema.optional(),
  request: MusicGenerationRequestSchema,
});

// Audio Generation Job Update
export const UpdateAudioGenerationJobSchema = z.object({
  jobId: UUIDSchema,
  status: GenerationStatusSchema,
  audioUrl: URLSchema.optional(),
  duration: z.number().positive().optional(),
  error: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Voice Clone
export const VoiceCloneSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  audioFiles: z.array(z.string()).min(1), // URLs or file paths
  labels: z.record(z.string()).optional(),
});

// Voice Library
export const VoiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: AudioProviderSchema,
  language: z.string(),
  gender: z.enum(['male', 'female', 'neutral']).optional(),
  age: z.enum(['young', 'middle-aged', 'old']).optional(),
  accent: z.string().optional(),
  description: z.string().optional(),
  previewUrl: URLSchema.optional(),
  settings: VoiceGenerationSettingsSchema.partial().optional(),
  isCustom: z.boolean().default(false),
});
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio-schemas/package.json` |
| CREATE | `packages/features/film-studio-schemas/tsconfig.json` |
| CREATE | `packages/features/film-studio-schemas/src/index.ts` |
| CREATE | `packages/features/film-studio-schemas/src/common.ts` |
| CREATE | `packages/features/film-studio-schemas/src/project.ts` |
| CREATE | `packages/features/film-studio-schemas/src/asset.ts` |
| CREATE | `packages/features/film-studio-schemas/src/episode.ts` |
| CREATE | `packages/features/film-studio-schemas/src/shot.ts` |
| CREATE | `packages/features/film-studio-schemas/src/video.ts` |
| CREATE | `packages/features/film-studio-schemas/src/audio.ts` |

## Acceptance Criteria
- [x] Package builds without errors
- [x] All schemas export correctly
- [x] TypeScript types can be inferred from schemas using z.infer<>
- [x] Schemas validate valid input correctly
- [x] Schemas reject invalid input with appropriate errors
- [x] Can be imported by other packages
- [x] No circular dependencies
- [x] All enums and constants are properly typed

## Test Plan
### Unit Tests
- [x] Package can be imported from other workspace packages
- [x] All export paths are accessible
- [x] Project schemas validate correctly
- [x] Asset schemas validate correctly (character, location, prop)
- [x] Episode schemas validate correctly
- [x] Shot schemas validate correctly
- [x] Video generation schemas validate correctly
- [x] Audio generation schemas validate correctly
- [x] Common schemas validate correctly
- [x] Invalid data is rejected with clear error messages
- [x] Type inference works correctly for all schemas

### Integration Tests
- [ ] Schemas work with react-hook-form and @hookform/resolvers
- [ ] Schemas work with Supabase type generation
- [ ] Schemas can be used in API route validation

## Implementation Notes

**Tests:** 172 unit tests covering all schema validations
- `__tests__/common.test.ts` - UUID, URL, Email, Pagination, Metadata schemas
- `__tests__/project.test.ts` - Project type, platform, style, settings schemas
- `__tests__/asset.test.ts` - Character, Location, Prop schemas
- `__tests__/episode.test.ts` - Episode CRUD, status, generation schemas
- `__tests__/shot.test.ts` - Shot status, camera angle/movement schemas
- `__tests__/video.test.ts` - Video generation, provider-specific schemas
- `__tests__/audio.test.ts` - Voice/Music generation schemas
