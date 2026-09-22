---
spec_id: FILM-107
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-107 @kit/video-generation Package

> **🗑️ Retired (audit 2026-09-23).** `@kit/video-generation` (Kling, Runway and Hailuo providers, webhooks, polling) was deleted in `5b88db3a` (2026-01-15, 94 files); the owner retired in-app video generation on purpose (decision 2026-09-23). The Visual Studio now writes VEO 3.1 prompts, and video made outside the app is uploaded through `apps/web/app/home/[account]/studio/[projectSlug]/episodes/[episodeSlug]/visual-studio/_components/frame-uploader.tsx`. Kept as a record; not outstanding work.

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Blocks:** Phase 4 (Video Generation)
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ COMPLETED)
- **PR:** https://github.com/aroundAI/storybook/pull/4

## Context
The @kit/video-generation package provides the abstraction layer for video generation services including Kling, Runway, and Luma. It handles API integration, request formatting, webhook processing, and status polling for video generation jobs. This package enables the core video creation functionality of the Film Studio.

## Specification

### Package Structure
```
packages/features/video-generation/
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
    ├── providers/
    │   ├── index.ts
    │   ├── kling.ts
    │   ├── runway.ts
    │   ├── luma.ts
    │   └── base.ts
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
  "name": "@kit/video-generation",
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
    "./providers": "./src/providers/index.ts",
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
| `./components` | UI components for video generation |
| `./server` | Server actions for video generation |
| `./providers` | Provider implementations (Kling, Runway, Luma) |
| `./lib` | Shared utilities, types, and constants |
| `./schemas` | Zod validation schemas |
| `./types` | TypeScript type definitions |
| `./hooks` | React hooks for video generation |

### Dependencies
| Package | Purpose |
|---------|---------|
| @kit/supabase | Database access for job tracking |
| @kit/shared | Shared utilities |
| @kit/ui | UI components library |
| zod | Schema validation |
| react | React framework |
| next | Next.js framework |

### Initial Files

#### src/index.ts
```typescript
export * from './components';
export * from './server';
export * from './providers';
export * from './lib';
export * from './hooks';
```

#### src/components/index.ts
```typescript
// Export video generation components here
// VideoGenerationStatus, ProviderSelector, GenerationSettings, etc.
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

// Server actions for video generation
export {};
```

#### src/server/queries.ts
```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Database queries for video generation jobs
export async function getGenerationJob(jobId: string) {
  const client = getSupabaseServerClient();
  // Implementation will be added
  return { data: null, error: null };
}
```

#### src/providers/index.ts
```typescript
export * from './base';
export * from './kling';
export * from './runway';
export * from './luma';
```

#### src/providers/base.ts
```typescript
import type { VideoGenerationRequest, VideoGenerationResponse, VideoGenerationStatus } from '../lib/types';

// Base provider interface
export interface VideoGenerationProvider {
  readonly name: string;
  readonly supportedAspectRatios: string[];
  readonly maxDuration: number;

  generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse>;
  getStatus(jobId: string): Promise<VideoGenerationStatus>;
  cancelJob(jobId: string): Promise<void>;
}

export abstract class BaseVideoGenerationProvider implements VideoGenerationProvider {
  abstract readonly name: string;
  abstract readonly supportedAspectRatios: string[];
  abstract readonly maxDuration: number;

  abstract generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse>;
  abstract getStatus(jobId: string): Promise<VideoGenerationStatus>;
  abstract cancelJob(jobId: string): Promise<void>;

  protected validateRequest(request: VideoGenerationRequest): void {
    // Common validation logic
  }
}
```

#### src/providers/kling.ts
```typescript
import { BaseVideoGenerationProvider } from './base';
import type { VideoGenerationRequest, VideoGenerationResponse, VideoGenerationStatus } from '../lib/types';

export class KlingProvider extends BaseVideoGenerationProvider {
  readonly name = 'kling';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1'];
  readonly maxDuration = 10;

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async cancelJob(jobId: string): Promise<void> {
    // Implementation will be added
    throw new Error('Not implemented');
  }
}
```

#### src/providers/runway.ts
```typescript
import { BaseVideoGenerationProvider } from './base';
import type { VideoGenerationRequest, VideoGenerationResponse, VideoGenerationStatus } from '../lib/types';

export class RunwayProvider extends BaseVideoGenerationProvider {
  readonly name = 'runway';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1', '4:5'];
  readonly maxDuration = 18;

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async cancelJob(jobId: string): Promise<void> {
    // Implementation will be added
    throw new Error('Not implemented');
  }
}
```

#### src/providers/luma.ts
```typescript
import { BaseVideoGenerationProvider } from './base';
import type { VideoGenerationRequest, VideoGenerationResponse, VideoGenerationStatus } from '../lib/types';

export class LumaProvider extends BaseVideoGenerationProvider {
  readonly name = 'luma';
  readonly supportedAspectRatios = ['16:9', '9:16', '1:1', '4:3', '3:4'];
  readonly maxDuration = 5;

  async generateVideo(request: VideoGenerationRequest): Promise<VideoGenerationResponse> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async getStatus(jobId: string): Promise<VideoGenerationStatus> {
    // Implementation will be added
    throw new Error('Not implemented');
  }

  async cancelJob(jobId: string): Promise<void> {
    // Implementation will be added
    throw new Error('Not implemented');
  }
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
// Video generation types
export type VideoProvider = 'kling' | 'runway' | 'luma';
export type GenerationStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface VideoGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  duration: number;
  aspectRatio: string;
  seed?: number;
  modelVersion?: string;
  settings?: Record<string, unknown>;
}

export interface VideoGenerationResponse {
  jobId: string;
  status: GenerationStatus;
  estimatedTime?: number;
  message?: string;
}

export interface VideoGenerationStatus {
  jobId: string;
  status: GenerationStatus;
  progress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  error?: string;
  completedAt?: string;
}

export interface VideoGenerationJob {
  id: string;
  shotId: string;
  provider: VideoProvider;
  providerJobId: string;
  status: GenerationStatus;
  request: VideoGenerationRequest;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  metadata: Record<string, unknown> | null;
}
```

#### src/lib/schemas.ts
```typescript
import { z } from 'zod';

// Video generation schemas
export const VideoProviderSchema = z.enum(['kling', 'runway', 'luma']);
export const GenerationStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);

export const VideoGenerationRequestSchema = z.object({
  prompt: z.string().min(1).max(2000),
  negativePrompt: z.string().max(1000).optional(),
  duration: z.number().positive().max(20),
  aspectRatio: z.string().regex(/^\d+:\d+$/),
  seed: z.number().int().positive().optional(),
  modelVersion: z.string().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const GenerateVideoSchema = z.object({
  shotId: z.string().uuid(),
  provider: VideoProviderSchema,
  request: VideoGenerationRequestSchema,
});
```

#### src/lib/constants.ts
```typescript
// Video generation constants
export const VIDEO_PROVIDERS = {
  KLING: 'kling',
  RUNWAY: 'runway',
  LUMA: 'luma',
} as const;

export const GENERATION_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

export const ASPECT_RATIOS = {
  LANDSCAPE: '16:9',
  PORTRAIT: '9:16',
  SQUARE: '1:1',
  INSTAGRAM: '4:5',
  STANDARD: '4:3',
} as const;

export const DEFAULT_GENERATION_SETTINGS = {
  duration: 5,
  aspectRatio: '16:9',
} as const;

export const PROVIDER_POLLING_INTERVAL = 5000; // 5 seconds
export const PROVIDER_MAX_RETRIES = 3;
export const PROVIDER_TIMEOUT = 300000; // 5 minutes
```

#### src/hooks/index.ts
```typescript
// Export React hooks for video generation
export {};
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `packages/features/video-generation/package.json` |
| CREATE | `packages/features/video-generation/tsconfig.json` |
| CREATE | `packages/features/video-generation/src/index.ts` |
| CREATE | `packages/features/video-generation/src/components/index.ts` |
| CREATE | `packages/features/video-generation/src/server/index.ts` |
| CREATE | `packages/features/video-generation/src/server/actions.ts` |
| CREATE | `packages/features/video-generation/src/server/queries.ts` |
| CREATE | `packages/features/video-generation/src/providers/index.ts` |
| CREATE | `packages/features/video-generation/src/providers/base.ts` |
| CREATE | `packages/features/video-generation/src/providers/kling.ts` |
| CREATE | `packages/features/video-generation/src/providers/runway.ts` |
| CREATE | `packages/features/video-generation/src/providers/luma.ts` |
| CREATE | `packages/features/video-generation/src/lib/index.ts` |
| CREATE | `packages/features/video-generation/src/lib/types.ts` |
| CREATE | `packages/features/video-generation/src/lib/schemas.ts` |
| CREATE | `packages/features/video-generation/src/lib/constants.ts` |
| CREATE | `packages/features/video-generation/src/hooks/index.ts` |

## Acceptance Criteria
- [x] Package builds without errors
- [x] All exports work correctly
- [x] TypeScript types exported and accessible
- [x] Zod schemas validate correctly
- [x] Provider interface is properly defined
- [x] All three providers implement base interface
- [x] Can be imported by other packages

## Test Plan
### Unit Tests
- [x] Package can be imported from other workspace packages
- [x] All export paths are accessible
- [x] Provider interface methods are defined
- [x] Zod schemas validate valid generation requests
- [x] Zod schemas reject invalid input
- [x] Constants are accessible

## Implementation Notes
- Implemented in PR #4
- Factory pattern with provider caching implemented
- Provider capabilities introspection (aspect ratios, max duration, features)
- Database operations use type assertions (`client as any`) since tables will be created in FILM-101
- Server actions: generateVideo, pollVideoStatus, cancelVideoJob
- Provider stubs ready for API integration (throw "not yet implemented")
