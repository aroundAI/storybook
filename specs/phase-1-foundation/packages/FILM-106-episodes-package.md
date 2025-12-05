# FILM-106 @kit/episodes Package

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Blocks:** Phase 3 (Episode Management)

## Context
The @kit/episodes package manages episodes and shots within the film production pipeline. It handles episode planning, shot creation, scene management, and coordinates the relationship between episodes, shots, and assets. This package is essential for organizing the narrative structure and production workflow.

## Specification

### Package Structure
```
packages/features/episodes/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── components/
    │   └── index.ts
    ├── server/
    │   ├── index.ts
    │   ├── actions.ts
    │   └── queries.ts
    ├── lib/
    │   ├── index.ts
    │   ├── types.ts
    │   ├── schemas.ts
    │   └── constants.ts
    └── hooks/
        └── index.ts
```

### package.json
```json
{
  "name": "@kit/episodes",
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
    "./components": "./src/components/index.ts",
    "./server": "./src/server/index.ts",
    "./lib": "./src/lib/index.ts",
    "./schemas": "./src/lib/schemas.ts",
    "./types": "./src/lib/types.ts",
    "./hooks": "./src/hooks/index.ts"
  },
  "dependencies": {
    "@kit/supabase": "workspace:*",
    "@kit/shared": "workspace:*",
    "@kit/ui": "workspace:*",
    "zod": "^3.22.4",
    "react": "^18.2.0",
    "react-hook-form": "^7.50.0",
    "@hookform/resolvers": "^3.3.0",
    "next": "^14.1.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
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
| `.` | Main exports (re-exports from all modules) |
| `./components` | UI components for episode and shot management |
| `./server` | Server actions and queries for episodes/shots |
| `./lib` | Shared utilities, types, and constants |
| `./schemas` | Zod validation schemas |
| `./types` | TypeScript type definitions |
| `./hooks` | React hooks for episode operations |

### Dependencies
| Package | Purpose |
|---------|---------|
| @kit/supabase | Database access for episodes and shots |
| @kit/shared | Shared utilities |
| @kit/ui | UI components library |
| zod | Schema validation |
| react-hook-form | Form management |
| @hookform/resolvers | Zod resolver for forms |

### Initial Files

#### src/index.ts
```typescript
export * from './components';
export * from './server';
export * from './lib';
export * from './hooks';
```

#### src/components/index.ts
```typescript
// Export episode components here
// EpisodeList, EpisodeCard, EpisodeForm, ShotList, ShotCard, ShotForm, SceneEditor, etc.
export {};
```

#### src/server/index.ts
```typescript
export * from './actions';
export * from './queries';
```

#### src/server/actions.ts
```typescript
'use server';

// Server actions for episode and shot CRUD operations
export {};
```

#### src/server/queries.ts
```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Database queries for episodes and shots
export async function getEpisodesByProject(projectId: string) {
  const client = getSupabaseServerClient();
  // Implementation will be added
  return { data: [], error: null };
}

export async function getShotsByEpisode(episodeId: string) {
  const client = getSupabaseServerClient();
  // Implementation will be added
  return { data: [], error: null };
}
```

#### src/lib/index.ts
```typescript
export * from './types';
export * from './schemas';
export * from './constants';
```

#### src/lib/types.ts
```typescript
// Episode and shot types
export type EpisodeStatus = 'draft' | 'planning' | 'in_progress' | 'completed' | 'published';
export type ShotStatus = 'pending' | 'generating' | 'completed' | 'failed';
export type CameraAngle = 'wide' | 'medium' | 'close-up' | 'extreme-close-up' | 'over-the-shoulder' | 'pov' | 'low-angle' | 'high-angle' | 'birds-eye' | 'dutch-angle';
export type CameraMovement = 'static' | 'pan' | 'tilt' | 'zoom' | 'dolly' | 'tracking' | 'crane' | 'handheld' | 'steadicam';

export interface Episode {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  episodeNumber: number;
  status: EpisodeStatus;
  script: string | null;
  duration: number | null;
  metadata: {
    sceneCount?: number;
    shotCount?: number;
    totalDuration?: number;
    themes?: string[];
    tags?: string[];
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Shot {
  id: string;
  episodeId: string;
  sceneNumber: number;
  shotNumber: number;
  description: string;
  duration: number;
  status: ShotStatus;
  cameraAngle: CameraAngle | null;
  cameraMovement: CameraMovement | null;
  prompt: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  metadata: {
    characters?: string[];
    locations?: string[];
    props?: string[];
    dialogue?: string;
    soundEffects?: string[];
    music?: string;
    lighting?: string;
    mood?: string;
  } | null;
  generationSettings: {
    provider?: 'kling' | 'runway' | 'luma';
    modelVersion?: string;
    aspectRatio?: string;
    duration?: number;
    seed?: number;
    negativePrompt?: string;
  } | null;
  generationJobId: string | null;
  generationStartedAt: string | null;
  generationCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

#### src/lib/schemas.ts
```typescript
import { z } from 'zod';

// Episode schemas
export const EpisodeStatusSchema = z.enum(['draft', 'planning', 'in_progress', 'completed', 'published']);

export const CreateEpisodeSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(255),
  description: z.string().optional(),
  episodeNumber: z.number().int().positive(),
  script: z.string().optional(),
  metadata: z.object({
    themes: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
  }).optional(),
});

export const UpdateEpisodeSchema = CreateEpisodeSchema.partial().extend({
  id: z.string().uuid(),
  status: EpisodeStatusSchema.optional(),
});

// Shot schemas
export const ShotStatusSchema = z.enum(['pending', 'generating', 'completed', 'failed']);
export const CameraAngleSchema = z.enum(['wide', 'medium', 'close-up', 'extreme-close-up', 'over-the-shoulder', 'pov', 'low-angle', 'high-angle', 'birds-eye', 'dutch-angle']);
export const CameraMovementSchema = z.enum(['static', 'pan', 'tilt', 'zoom', 'dolly', 'tracking', 'crane', 'handheld', 'steadicam']);

export const CreateShotSchema = z.object({
  episodeId: z.string().uuid(),
  sceneNumber: z.number().int().positive(),
  shotNumber: z.number().int().positive(),
  description: z.string().min(1),
  duration: z.number().positive(),
  cameraAngle: CameraAngleSchema.optional(),
  cameraMovement: CameraMovementSchema.optional(),
  prompt: z.string().optional(),
  metadata: z.object({
    characters: z.array(z.string()).optional(),
    locations: z.array(z.string()).optional(),
    props: z.array(z.string()).optional(),
    dialogue: z.string().optional(),
    soundEffects: z.array(z.string()).optional(),
    music: z.string().optional(),
    lighting: z.string().optional(),
    mood: z.string().optional(),
  }).optional(),
});

export const UpdateShotSchema = CreateShotSchema.partial().extend({
  id: z.string().uuid(),
  status: ShotStatusSchema.optional(),
  videoUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
});
```

#### src/lib/constants.ts
```typescript
// Episode and shot constants
export const EPISODE_STATUS = {
  DRAFT: 'draft',
  PLANNING: 'planning',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PUBLISHED: 'published',
} as const;

export const SHOT_STATUS = {
  PENDING: 'pending',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const CAMERA_ANGLES = [
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'pov',
  'low-angle',
  'high-angle',
  'birds-eye',
  'dutch-angle',
] as const;

export const CAMERA_MOVEMENTS = [
  'static',
  'pan',
  'tilt',
  'zoom',
  'dolly',
  'tracking',
  'crane',
  'handheld',
  'steadicam',
] as const;

export const DEFAULT_SHOT_DURATION = 5; // seconds
export const MAX_SHOTS_PER_SCENE = 100;
```

#### src/hooks/index.ts
```typescript
// Export React hooks for episode and shot operations
export {};
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `packages/features/episodes/package.json` |
| CREATE | `packages/features/episodes/tsconfig.json` |
| CREATE | `packages/features/episodes/src/index.ts` |
| CREATE | `packages/features/episodes/src/components/index.ts` |
| CREATE | `packages/features/episodes/src/server/index.ts` |
| CREATE | `packages/features/episodes/src/server/actions.ts` |
| CREATE | `packages/features/episodes/src/server/queries.ts` |
| CREATE | `packages/features/episodes/src/lib/index.ts` |
| CREATE | `packages/features/episodes/src/lib/types.ts` |
| CREATE | `packages/features/episodes/src/lib/schemas.ts` |
| CREATE | `packages/features/episodes/src/lib/constants.ts` |
| CREATE | `packages/features/episodes/src/hooks/index.ts` |

## Acceptance Criteria
- [ ] Package builds without errors
- [ ] All exports work correctly
- [ ] TypeScript types exported and accessible
- [ ] Zod schemas validate correctly
- [ ] Can be imported by other packages
- [ ] Server actions have 'use server' directive

## Test Plan
### Unit Tests
- [ ] Package can be imported from other workspace packages
- [ ] All export paths are accessible
- [ ] Zod schemas validate valid episode data
- [ ] Zod schemas validate valid shot data
- [ ] Zod schemas reject invalid input
- [ ] Constants are accessible
