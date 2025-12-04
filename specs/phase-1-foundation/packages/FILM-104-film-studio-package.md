# FILM-104 @kit/film-studio Package

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** None
- **Blocks:** Phase 2-5 features

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
- [ ] Package builds without errors
- [ ] All exports work correctly
- [ ] TypeScript types exported and accessible
- [ ] Can be imported by other packages
- [ ] tsconfig properly extends root configuration

## Test Plan
### Unit Tests
- [ ] Package can be imported from other workspace packages
- [ ] All export paths are accessible
- [ ] Types are properly exported
- [ ] Constants are accessible
