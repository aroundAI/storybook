---
spec_id: FILM-104
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-104 @kit/film-studio Package

> **🗑️ Retired (audit 2026-09-23).** `@kit/film-studio` was deleted in `5f44d0e1` (2026-02-19, "remove dead video editor code, film-studio package, and orphaned routes"). Its one live piece, the API-keys settings, moved to `apps/web/app/home/[account]/settings/_components/api-keys-settings.tsx`; nothing replaces the orchestration package (`packages/features/film-studio-schemas` is FILM-109's Zod schemas, not a successor). Kept as a record; not outstanding work.

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Blocks:** Phase 2-5 features
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ COMPLETED)
- **PR:** [#2](https://github.com/aroundAI/storybook/pull/2)

## Context
The @kit/film-studio package provides the core orchestration layer for the Film Studio feature. It manages the overall studio workflow, coordinates between episodes, shots, and generation services, and provides shared utilities and types for the entire film production pipeline.

## Specification

### Package Structure
```
packages/features/film-studio/
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts
    ├── components/
    │   └── index.ts
    ├── server/
    │   └── index.ts
    └── lib/
        ├── index.ts
        ├── types.ts
        └── constants.ts
```

### package.json
```json
{
  "name": "@kit/film-studio",
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
    "./types": "./src/lib/types.ts"
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
| `./components` | UI components for studio orchestration |
| `./server` | Server actions for studio operations |
| `./lib` | Shared utilities, types, and constants |
| `./types` | TypeScript type definitions |

### Dependencies
| Package | Purpose |
|---------|---------|
| @kit/supabase | Database access and Supabase client |
| @kit/shared | Shared utilities and helpers |
| @kit/ui | UI components library |
| zod | Schema validation |
| react | React framework |
| next | Next.js framework |

### Initial Files

#### src/index.ts
```typescript
export * from './components';
export * from './server';
export * from './lib';
```

#### src/components/index.ts
```typescript
// Export studio components here
export {};
```

#### src/server/index.ts
```typescript
// Export server actions here
export {};
```

#### src/lib/index.ts
```typescript
export * from './types';
export * from './constants';
```

#### src/lib/types.ts
```typescript
// Core studio types
export type StudioWorkflowStatus = 'idle' | 'planning' | 'generating' | 'processing' | 'completed' | 'error';

export interface StudioContext {
  projectId: string;
  episodeId?: string;
  shotId?: string;
  status: StudioWorkflowStatus;
}
```

#### src/lib/constants.ts
```typescript
// Studio constants
export const STUDIO_WORKFLOW_STATES = {
  IDLE: 'idle',
  PLANNING: 'planning',
  GENERATING: 'generating',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  ERROR: 'error',
} as const;
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `packages/features/film-studio/package.json` |
| CREATE | `packages/features/film-studio/tsconfig.json` |
| CREATE | `packages/features/film-studio/src/index.ts` |
| CREATE | `packages/features/film-studio/src/components/index.ts` |
| CREATE | `packages/features/film-studio/src/server/index.ts` |
| CREATE | `packages/features/film-studio/src/lib/index.ts` |
| CREATE | `packages/features/film-studio/src/lib/types.ts` |
| CREATE | `packages/features/film-studio/src/lib/constants.ts` |

## Acceptance Criteria
- [x] Package builds without errors
- [x] All exports work correctly
- [x] TypeScript types exported and accessible
- [x] Can be imported by other packages
- [x] tsconfig properly extends root configuration

## Test Plan
### Unit Tests
- [x] Package can be imported from other workspace packages
- [x] All export paths are accessible
- [x] Types are properly exported
- [x] Constants are accessible

## Implementation Notes
- Implemented on 2024-12-05
- Package created at `packages/features/film-studio/`
- Uses workspace conventions (devDependencies, @kit/tsconfig, prettier config)
- Typecheck passes with `pnpm --filter @kit/film-studio typecheck`
