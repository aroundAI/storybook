# FILM-105 @kit/assets Package

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Blocks:** Phase 2 (Asset Management)

## Context
The @kit/assets package manages all asset-related functionality including characters, locations, and props. It provides CRUD operations, UI components for asset management, and server actions for asset operations. This package is central to the content creation workflow as assets are reused across episodes and shots.

## Specification

### Package Structure
```
packages/features/assets/
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
  "name": "@kit/assets",
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
| `./components` | UI components for asset management |
| `./server` | Server actions and queries for assets |
| `./lib` | Shared utilities, types, and constants |
| `./schemas` | Zod validation schemas |
| `./types` | TypeScript type definitions |
| `./hooks` | React hooks for asset operations |

### Dependencies
| Package | Purpose |
|---------|---------|
| @kit/supabase | Database access for asset storage |
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
// Export asset components here
// AssetList, AssetCard, AssetForm, CharacterForm, LocationForm, etc.
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

// Server actions for asset CRUD operations
export {};
```

#### src/server/queries.ts
```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Database queries for assets
export async function getAssetsByProject(projectId: string) {
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
// Asset types
export type AssetType = 'character' | 'location' | 'prop';

export interface Asset {
  id: string;
  projectId: string;
  type: AssetType;
  name: string;
  description: string | null;
  imageUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Character extends Asset {
  type: 'character';
  metadata: {
    physicalAttributes?: {
      age?: string;
      gender?: string;
      height?: string;
      build?: string;
      hairColor?: string;
      eyeColor?: string;
      distinctiveFeatures?: string;
    };
    personality?: string;
    backstory?: string;
    voiceSettings?: {
      voiceId?: string;
      provider?: 'elevenlabs' | 'suno';
      stability?: number;
      similarityBoost?: number;
    };
  };
}

export interface Location extends Asset {
  type: 'location';
  metadata: {
    setting?: string;
    timeOfDay?: string;
    weather?: string;
    atmosphere?: string;
  };
}
```

#### src/lib/schemas.ts
```typescript
import { z } from 'zod';

// Zod schemas for validation
export const AssetTypeSchema = z.enum(['character', 'location', 'prop']);

export const PhysicalAttributesSchema = z.object({
  age: z.string().optional(),
  gender: z.string().optional(),
  height: z.string().optional(),
  build: z.string().optional(),
  hairColor: z.string().optional(),
  eyeColor: z.string().optional(),
  distinctiveFeatures: z.string().optional(),
});

export const VoiceSettingsSchema = z.object({
  voiceId: z.string().optional(),
  provider: z.enum(['elevenlabs', 'suno']).optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
});

export const CreateAssetSchema = z.object({
  projectId: z.string().uuid(),
  type: AssetTypeSchema,
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  imageUrl: z.string().url().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const UpdateAssetSchema = CreateAssetSchema.partial().extend({
  id: z.string().uuid(),
});
```

#### src/lib/constants.ts
```typescript
// Asset constants
export const ASSET_TYPES = {
  CHARACTER: 'character',
  LOCATION: 'location',
  PROP: 'prop',
} as const;

export const DEFAULT_ASSET_IMAGE = '/assets/placeholder.png';
```

#### src/hooks/index.ts
```typescript
// Export React hooks for asset operations
export {};
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `packages/features/assets/package.json` |
| CREATE | `packages/features/assets/tsconfig.json` |
| CREATE | `packages/features/assets/src/index.ts` |
| CREATE | `packages/features/assets/src/components/index.ts` |
| CREATE | `packages/features/assets/src/server/index.ts` |
| CREATE | `packages/features/assets/src/server/actions.ts` |
| CREATE | `packages/features/assets/src/server/queries.ts` |
| CREATE | `packages/features/assets/src/lib/index.ts` |
| CREATE | `packages/features/assets/src/lib/types.ts` |
| CREATE | `packages/features/assets/src/lib/schemas.ts` |
| CREATE | `packages/features/assets/src/lib/constants.ts` |
| CREATE | `packages/features/assets/src/hooks/index.ts` |

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
- [ ] Zod schemas validate valid input
- [ ] Zod schemas reject invalid input
- [ ] Types are properly exported
