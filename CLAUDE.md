This file provides guidance to Claude Code when working with code in this repository.

## Core Technologies

- **Next.js 15** with App Router
- **React 19**
- **TypeScript**
- **Tailwind CSS 4** and Shadcn UI
- **Turborepo** monorepo structure

## Deployment & Infrastructure

### Deployment Options

This platform supports **vendor-agnostic deployment** via SST (Serverless Stack) with OpenNext 3.8.0:

| Option | Time to Deploy | Monthly Cost | Best For | Infrastructure |
|--------|----------------|--------------|----------|----------------|
| **Vercel + Supabase** | 10 minutes | ~$35 | MVPs, rapid iteration | Vercel hosting + Supabase all-in-one |
| **AWS Lambda (SST)** | 2-4 hours | ~$95 | Scale, compliance, control | Full AWS stack |
| **Hybrid** | 1 hour | ~$37 | **Best value** | Supabase DB+Auth, AWS services |

**Detailed deployment guides**: See `DEPLOYMENT.md` for step-by-step instructions.

### Preferred Technology Stack

**Recommended configuration for optimal cost/performance:**

- **Database**: Supabase PostgreSQL (excellent DX, includes connection pooling)
- **Authentication**: Supabase Auth (OAuth, MFA, magic links built-in)
- **Hosting**: AWS Lambda via SST + OpenNext 3.8.0
- **Storage**: AWS S3 (cheaper at scale, ~$0.023/GB)
- **Email**: Resend (free tier: 3K emails/month) or AWS SES (production scale)
- **Queue**: AWS SQS (pay-per-use, $1/month typical)
- **Cache**: Upstash Redis (serverless, 10K commands/day free)
- **CDN**: AWS CloudFront (included with SST deployment)

**Infrastructure as Code**: See `sst.config.ts` for complete AWS infrastructure configuration.

### Vendor Agnosticism

**Zero code changes required to switch providers** - just update environment variables:

```bash
# Example: Switch from Supabase to full AWS stack
DATABASE_PROVIDER=postgresql  # Was: supabase
AUTH_PROVIDER=cognito        # Was: supabase
STORAGE_PROVIDER=s3          # Was: supabase
EMAIL_PROVIDER=ses           # Was: resend
QUEUE_PROVIDER=sqs
CACHE_PROVIDER=redis
REDIS_URL=redis://upstash-or-elasticache...
```

**Provider abstraction packages** (`@kit/providers-*`):
- `@kit/providers-database` - Supabase, PostgreSQL, MySQL
- `@kit/providers-storage` - Supabase Storage, S3, GCS, Azure Blob
- `@kit/providers-email` - Resend, SES, SendGrid, Nodemailer
- `@kit/providers-queue` - SQS, BullMQ
- `@kit/providers-cache` - Redis (Upstash, ElastiCache), Memory

**Migration guides**: See `SUPABASE_VENDOR_LOCKIN_REPORT.md` for detailed migration strategies.

## Monorepo Structure

```
base-saas/
├── apps/
│   ├── web/                    # Main Next.js SaaS application
│   │   ├── app/               # Next.js App Router
│   │   │   ├── (marketing)/  # Public pages
│   │   │   ├── admin/        # Super admin section
│   │   │   ├── auth/         # Authentication pages
│   │   │   ├── home/
│   │   │   │   ├── (user)/   # Personal account routes
│   │   │   │   └── [account]/# Team account routes
│   │   │   └── api/          # API routes
│   │   ├── supabase/         # Database schemas & migrations
│   │   │   ├── migrations/   # SQL migrations
│   │   │   └── schemas/      # Schema source files
│   │   ├── lambda/           # AWS Lambda functions
│   │   │   └── email-worker/ # SQS email worker
│   │   └── websocket/        # WebSocket handlers
│   ├── dev-tool/              # Development utilities
│   └── e2e/                   # Playwright end-to-end tests
├── packages/
│   ├── features/              # Feature packages
│   │   ├── accounts/         # Personal account management
│   │   ├── admin/            # Super admin functionality
│   │   ├── auth/             # Authentication flows
│   │   ├── notifications/    # Notification system
│   │   ├── projects/         # Project management
│   │   ├── prompt-engine/    # JSON file-based LLM prompt management
│   │   └── team-accounts/    # Team workspace management
│   ├── billing/              # Payment & subscription handling
│   ├── analytics/            # Analytics integration
│   ├── cache/                # Cache abstraction layer
│   ├── cms/                  # CMS integration (Keystatic)
│   ├── database-webhooks/    # Database event handlers
│   ├── email-templates/      # React Email templates
│   ├── i18n/                 # Internationalization
│   ├── llm/                  # LLM abstraction layer (OpenAI, Anthropic, Gemini)
│   ├── mailers/              # Email provider clients
│   ├── monitoring/           # Observability (Baselime)
│   ├── next/                 # Next.js utilities (actions, routes)
│   ├── otp/                  # One-time password verification
│   ├── shared/               # Shared utilities & types
│   ├── supabase/             # Supabase client & types
│   └── ui/                   # UI components (Shadcn)
├── tooling/                   # Build tools & configs
├── sst.config.ts             # AWS Lambda infrastructure (SST)
├── DEPLOYMENT.md             # Comprehensive deployment guide
└── SUPABASE_VENDOR_LOCKIN_REPORT.md  # Provider migration strategies
```

**Navigation Tips**:
- Each package has its own `CLAUDE.md` with specific guidance
- Check `apps/web/CLAUDE.md` for web application patterns
- See `apps/web/supabase/CLAUDE.md` for database workflows
- Review `packages/features/CLAUDE.md` for feature development

## Multi-Tenant Architecture

**Personal Accounts**: Individual user accounts (auth.users.id = accounts.id)
**Team Accounts**: Shared workspaces with members, roles, and permissions

Data associates with accounts via foreign keys for proper access control.

## Essential Commands

### Development Workflow

```bash
pnpm dev                    # Start all apps
pnpm --filter web dev       # Main app (port 3000)
```

### Database Operations

```bash
pnpm supabase:web:start     # Start Supabase locally
pnpm --filter web supabase migration up     # Apply new migrations
pnpm supabase:web:reset     # Reset with latest schema (clean rebuild)
pnpm supabase:web:typegen   # Generate TypeScript types
pnpm --filter web supabase:db:diff  # Create migration
```

The typegen command must be run after applying migrations or resetting the database.

## Database Workflow - CRITICAL SEQUENCE ⚠️

When adding new database features, ALWAYS follow this exact order:

### Method 1: Using db diff (Recommended for modifications)

1. **Create/modify schema file** in `apps/web/supabase/schemas/XX-feature.sql`
2. **Generate migration**: `pnpm --filter web supabase db diff -f <migration_name>`
3. **Apply migration**: `pnpm --filter web supabase migration up`
4. **Generate types**: `supabase gen types typescript --local > lib/database.types.ts && cp lib/database.types.ts /path/to/packages/supabase/src/database.types.ts`
5. **Verify types exist** before using in code

### Method 2: Manual migration from schema (For new features)

1. **Create schema file** in `apps/web/supabase/schemas/XX-feature.sql`
2. **Create timestamped migration**:
   ```bash
   timestamp=$(date -u +"%Y%m%d%H%M%S")
   cp apps/web/supabase/schemas/XX-feature.sql "apps/web/supabase/migrations/${timestamp}_feature-name.sql"
   ```
3. **Reset database**: `pnpm --filter web supabase db reset`
4. **Generate types**: `supabase gen types typescript --local > lib/database.types.ts && cp lib/database.types.ts /path/to/packages/supabase/src/database.types.ts`
5. **Verify types exist** before using in code

⚠️ **IMPORTANT**: Schema files alone don't create tables! You MUST either:
- Generate a migration with `db diff`, OR
- Manually copy the schema to migrations folder with timestamp

**Migration vs Reset**:
- Use `migration up` for normal development (applies only new migrations)
- Use `reset` when you need a clean database state or have schema conflicts

### Code Quality

```bash
pnpm format:fix 
pnpm lint:fix
pnpm typecheck
```

- Run the typecheck command regularly to ensure your code is type-safe.
- Run the linter and the formatter when your task is complete.

## Testing

### Overview

This repository uses **Vitest 3.2.4** for unit and integration testing with comprehensive coverage across packages.

**Current Status** (as of 2025-10-19):
- ✅ Test infrastructure: 100% complete
- ✅ CI/CD integration: GitHub Actions configured
- ✅ Tests passing: 62 tests across 2 packages
- 📊 Coverage: Foundation established, ~80 test files remaining

**Documentation**:
- **TESTING-PROGRESS.md** - Detailed progress tracking (updated regularly)
- **TESTING-IMPLEMENTATION-SUMMARY.md** - Complete overview and roadmap
- **apps/web/CLAUDE.md** - Web-specific testing patterns (see Testing section)

### Quick Commands

```bash
# Run all tests for web app
pnpm --filter web test

# Run tests for specific package
pnpm --filter @kit/branding test
pnpm --filter @kit/next test
pnpm --filter @kit/cache test

# Run with coverage report
pnpm --filter web test:coverage

# Run with interactive UI
pnpm --filter web test:ui

# Watch mode (auto-run on file changes)
pnpm --filter web test
```

### Test Infrastructure

**Locations**:
- `apps/web/vitest.config.ts` - React component testing (happy-dom)
- `apps/web/vitest.setup.ts` - Next.js mocks and test setup
- `apps/web/test/` - Web app test files
- `packages/*/vitest.config.ts` - Package-specific configs
- `packages/*/__tests__/` - Package test files

**Configured Packages**:
- ✅ @kit/branding
- ✅ @kit/next
- ✅ @kit/llm
- ✅ @kit/cache (pre-existing)

### Writing Tests

#### Test File Naming Convention

```bash
# Unit tests (pure functions, utilities)
packages/my-package/__tests__/utils.test.ts

# Integration tests (server actions, API routes)
apps/web/app/api/__tests__/route.test.ts

# Feature tests (complex features)
packages/features/my-feature/__tests__/mutations.test.ts
```

#### Basic Test Structure

```typescript
import { describe, expect, it } from 'vitest';
import { functionToTest } from '../src/function';

describe('Feature Name', () => {
  describe('functionToTest', () => {
    it('should handle valid inputs', () => {
      const result = functionToTest(validInput);
      expect(result).toBe(expectedOutput);
    });

    it('should handle invalid inputs', () => {
      expect(() => functionToTest(invalidInput)).toThrow();
    });

    it('should handle edge cases', () => {
      expect(functionToTest(null)).toBeNull();
      expect(functionToTest(undefined)).toBeUndefined();
      expect(functionToTest('')).toBe('');
    });
  });
});
```

#### Mocking Patterns

**Next.js Navigation**:
```typescript
import { vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT;${url}`);
  }),
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
  }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));
```

**Server-Only Module**:
```typescript
// vitest.config.ts
resolve: {
  alias: {
    'server-only': './src/__mocks__/server-only.ts'
  }
}

// src/__mocks__/server-only.ts
export {};
```

**Supabase Client** (to be implemented):
```typescript
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    })),
  })),
}));
```

### Test Categories

#### 1. Utility Functions (Pure Functions)

**What to test**:
- Color utilities (hex validation, WCAG contrast)
- String formatting (currency, dates)
- Validation functions
- Calculation algorithms

**Example** (packages/branding/__tests__/color-utils.test.ts):
```typescript
describe('hexToRgb', () => {
  it('should convert valid hex to RGB', () => {
    expect(hexToRgb('#FF0000')).toEqual({ r: 255, g: 0, b: 0 });
  });

  it('should return null for invalid hex', () => {
    expect(hexToRgb('#GGGGGG')).toBeNull();
  });
});
```

#### 2. Server Actions

**What to test**:
- Schema validation
- Authentication enforcement
- Error handling
- Return value correctness

**Example** (packages/next/__tests__/enhance-action.test.ts):
```typescript
describe('enhanceAction', () => {
  it('should validate input with schema', async () => {
    const action = enhanceAction(mockFn, {
      schema: TestSchema,
      auth: false,
    });

    const result = await action({ name: 'John', age: 30 });
    expect(mockFn).toHaveBeenCalledWith({ name: 'John', age: 30 }, undefined);
  });
});
```

#### 3. Provider Abstractions

**What to test**:
- Factory pattern (singleton behavior)
- Provider switching
- Configuration loading from env
- Error handling for missing config

**Example** (to be implemented - @kit/llm):
```typescript
describe('createLLMClient', () => {
  it('should create client from environment variables', () => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.OPENAI_API_KEY = 'sk-test';

    const client = createLLMClient();
    expect(client).toBeDefined();
  });

  it('should return singleton instance', () => {
    const client1 = createLLMClient();
    const client2 = createLLMClient();
    expect(client1).toBe(client2);
  });
});
```

#### 4. Business Logic

**What to test**:
- Permission checks
- Validation logic
- State transitions
- Edge cases and error conditions

**Example** (to be implemented - @kit/projects):
```typescript
describe('hasProjectRole', () => {
  it('should return true when user has role', async () => {
    const hasRole = await hasProjectRole('project-id', 'user-id', 'owner');
    expect(hasRole).toBe(true);
  });

  it('should return false when user lacks role', async () => {
    const hasRole = await hasProjectRole('project-id', 'user-id', 'admin');
    expect(hasRole).toBe(false);
  });
});
```

### Adding Tests to New Packages

**Step 1: Add vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node', // or 'happy-dom' for React components
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', '**/*.test.ts', '**/*.config.ts'],
    },
  },
});
```

**Step 2: Update package.json**

```json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage"
  },
  "devDependencies": {
    "vitest": "^3.2.4"
  }
}
```

**Step 3: Create test file**

```bash
mkdir -p packages/my-package/__tests__
touch packages/my-package/__tests__/feature.test.ts
```

**Step 4: Write tests**

Follow the patterns in existing test files:
- `packages/branding/__tests__/color-utils.test.ts` (utility functions)
- `packages/next/__tests__/enhance-action.test.ts` (server actions)
- `packages/cache/src/__tests__/factory.test.ts` (factory pattern)

**Step 5: Run tests**

```bash
pnpm install --filter @my/package
pnpm --filter @my/package test
```

### CI/CD Integration

Tests run automatically in GitHub Actions on:
- **Pull requests** to main branch
- **Pushes** to main branch

**Workflow**: `.github/workflows/workflow.yml`

```yaml
unit-test:
  name: 🧪 Unit Tests
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v4
    - uses: actions/setup-node@v4
    - run: pnpm install
    - run: pnpm --filter web test
    - run: pnpm --filter web test:coverage
    - uses: actions/upload-artifact@v4
      with:
        name: coverage-report
        path: apps/web/coverage/
```

### Coverage Targets

**Goals**:
- **Core utilities**: 90%+ (branding, cache, shared)
- **Business logic**: 85%+ (billing, auth, teams, projects)
- **API routes**: 80%+
- **Server actions**: 80%+
- **Overall target**: 75%+

**Current coverage**: See `TESTING-PROGRESS.md` for up-to-date statistics.

### Best Practices

**DO**:
- ✅ Test pure functions thoroughly
- ✅ Test edge cases and error conditions
- ✅ Mock external services (Supabase, Redis, APIs)
- ✅ Use descriptive test names
- ✅ Test real-world scenarios
- ✅ Run tests before committing
- ✅ Add tests for new features

**DON'T**:
- ❌ Test implementation details
- ❌ Hit real APIs in tests
- ❌ Write tests that depend on external state
- ❌ Skip tests with `.skip()` without good reason
- ❌ Commit failing tests
- ❌ Mock everything (test real code when possible)

### Troubleshooting

**Problem**: `Cannot find module 'server-only'`
**Solution**: Add alias in vitest.config.ts (see "Server-Only Module" above)

**Problem**: Tests timeout
**Solution**: Increase timeout in vitest.config.ts or individual tests:
```typescript
it('slow test', async () => {
  // Test code
}, { timeout: 10000 }); // 10 seconds
```

**Problem**: Mock not working
**Solution**: Ensure mock is defined before importing the module:
```typescript
vi.mock('./module'); // Must be at top of file
import { function } from './module';
```

### Next Session Roadmap

See **TESTING-PROGRESS.md** for detailed list of remaining tests.

**Priority order**:
1. @kit/llm (factory, pricing, providers) - 5 files
2. @kit/billing (webhook verification) - 4 files
3. @kit/prompt-engine (validation, loader, executor) - 3 files
4. @kit/projects (permissions, mutations) - 4 files
5. @kit/team-accounts (invitations, billing) - 6 files
6. Remaining packages - 56 files

**Estimated effort**: 30-40 hours for complete coverage

**Reference implementations**:
- ✅ `packages/branding/__tests__/color-utils.test.ts` (41 tests)
- ✅ `packages/next/__tests__/enhance-action.test.ts` (21 tests)

## Feature Specifications

Feature implementations must adhere to the specifications in the `specs/` folder:

- **Before implementing a feature**: Check if a spec exists in `specs/` for the feature (e.g., `specs/phase-5-audio-generation/providers/FILM-510-voice-cloning.md`)
- **During implementation**: Follow the database schema, API design, and component structure defined in the spec
- **After implementation**: Update the spec file to mark acceptance criteria as complete and change status to `✅ DONE`
- **Spec index**: See `specs/INDEX.md` for a complete list of all specifications and their status

When a spec exists for a feature, treat it as the source of truth for requirements, database schema design, and acceptance criteria.

## Episodes & Content Generation

The platform uses a multi-stage AI-powered content generation pipeline for creating video content.

### Episode Workflow

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

### Key Packages

| Package | Purpose |
|---------|---------|
| `@kit/episodes` | Episode management, story generation, shot lists |
| `@kit/prompt-engine` | JSON-based LLM prompt templates |
| `@kit/content-analytics` | Platform performance insights |
| `@kit/audio-generation` | TTS and music generation |

### Scene-by-Scene Shot Generation

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

### VEO 3.1 Prompt Structure

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

### Duration-Based Scaling

Content requirements scale automatically based on target duration:

```typescript
import { calculateContentScaling } from '@kit/episodes';

const scaling = calculateContentScaling({
  targetDurationSeconds: 300, // 5 minutes
  contentStyle: 'dialogue-heavy', // or 'balanced', 'action-heavy'
});
// Returns: ~750 words, ~7 scenes, ~40 dialogue lines, ~43 shots
```

### SCORE Framework

Episode continuity across a series:
- `episodeSummary` - 2-3 sentence plot summary
- `sentimentScore` - Emotional tone (0-1)
- `keyEvents` - Major plot points affecting future episodes

See `packages/features/episodes/README.md` for complete documentation.

## Typescript

- Write clean, clear, well-designed, explicit TypeScript
- Avoid obvious comments
- Avoid unnecessary complexity or overly abstract code
- Always use implicit type inference, unless impossible
- You must avoid using `any`
- Handle errors gracefully using try/catch and appropriate error types
- Use service pattern for server-side APIs
- Add `server-only` to code that is exclusively server-side
- Never mix client and server imports from a file or a package
- Extract self-contained classes/utilities (ex. algortihmic code) from classes that cross the network boundary

## React

- Encapsulate repeated blocks of code into reusable local components
- Write small, composable, explicit, well-named components
- Always use `react-hook-form` and `@kit/ui/form` for writing forms
- Always use 'use client' directive for client components
- Add `data-test` for E2E tests where appropriate
- `useEffect` is a code smell and must be justified - avoid if possible
- Do not write many (such as 4-5) separate `useState`, prefer single state object (unless required)
- Prefer server-side data fetching using RSC
- Display loading indicators (ex. with LoadingSpinner) component where appropriate

## Next.js

- Use `enhanceAction` for Server Actions
- Use `enhanceRouteHandler` for API Routes
- Export page components using the `withI18n` utility
- Add well-written page metadata to pages
- Redirect using `redirect` following a server action instead of using client-side router
- Since `redirect` throws an error, handle `catch` block using `isRedirectError` from `next/dist/client/components/redirect-error`

## UI Components

- UI Components are placed at `packages/ui`. Call MCP tool to list components to verify they exist.

## Form Architecture

Always organize schemas for reusability between server actions and client forms:

```
_lib/
├── schemas/
│   └── feature.schema.ts    # Shared Zod schemas
├── server/
│   └── server-actions.ts # Server actions import schemas
└── client/
    └── forms.tsx    # Forms import same schemas
```

**Example implementation:**

```typescript
// _lib/schemas/project.schema.ts
export const CreateProjectSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

// _lib/server/project.mutations.ts
import { CreateProjectSchema } from '../schemas/project.schema';

export const createProjectAction = enhanceAction(
  async (data) => { /* implementation */ },
  { schema: CreateProjectSchema }
);

// _components/create-project-form.tsx
import { CreateProjectSchema } from '../_lib/schemas/project.schema';

const form = useForm({
  resolver: zodResolver(CreateProjectSchema)
});
```

## Import Guidelines - ALWAYS Check These

**UI Components**: Always check `@kit/ui` first before external packages:
- Toast notifications: `import { toast } from '@kit/ui/sonner'`
- Forms: `import { Form, FormField, ... } from '@kit/ui/form'`
- All UI components: Use MCP tool to verify: `mcp__makerkit__get_components`

**React Hook Form Pattern**:
```typescript
// ❌ WRONG - Redundant generic with resolver
const form = useForm<FormData>({
  resolver: zodResolver(Schema)
});

// ✅ CORRECT - Type inference from resolver
const form = useForm({
  resolver: zodResolver(Schema)
});
```

## Git Workflow

**IMPORTANT**: Always use `origin` as the remote name, not `upstream`.

**CRITICAL**: NEVER discard uncommitted changes with `git checkout --` or `git restore` without explicit user approval. Modified files may contain work from linting, formatting, or type fixes that need to be committed. Always ask before discarding changes.

```bash
# ✅ CORRECT - Use origin
git push origin feature-branch
git pull origin main
git fetch origin

# ❌ WRONG - Don't use upstream
git push upstream feature-branch  # Never do this
```

**Branching**:
```bash
# Create feature branch from main
git checkout -b feat/feature-name main

# Push to origin
git push -u origin feat/feature-name
```

**Pull Requests**:
```bash
# Create PR via GitHub CLI
gh pr create --base main --head feat/feature-name

# Or push and use the GitHub URL
git push origin feat/feature-name
# Then visit the URL in the terminal output
```

## Verification Steps

After implementation:
1. **Run `pnpm typecheck`** - Must pass without errors
2. **Run `pnpm lint:fix`** - Auto-fix issues
3. **Run `pnpm format:fix`** - Format code
4. **Verify spec compliance** - If implementing a feature from `specs/`, ensure the spec document is updated to match any implementation changes