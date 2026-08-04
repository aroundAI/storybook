This file provides guidance to Claude Code when working with code in this repository.

## Deployment & Infrastructure

Deployed to AWS Lambda via SST + OpenNext, with Supabase for database and auth. See `DEPLOYMENT.md` for step-by-step guides, `sst.config.ts` for the infrastructure definition, and `SUPABASE_VENDOR_LOCKIN_REPORT.md` for provider migration strategies.

## Navigation

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

⚠️ **Schema files alone don't create tables.** Editing `apps/web/supabase/schemas/` has no effect until you either generate a migration with `db diff` or copy the schema into `migrations/` with a timestamp — and types must be regenerated and verified before use in code.

Use the `database-migrations` skill for the full sequence in either direction.

### Code Quality

```bash
pnpm format:fix 
pnpm lint:fix
pnpm typecheck
```

- Run the typecheck command regularly to ensure your code is type-safe.
- Run the linter and the formatter when your task is complete.

## Testing

Vitest, configured per package (`packages/*/vitest.config.ts`, `apps/web/vitest.config.ts` with happy-dom for components; `apps/web/vitest.setup.ts` holds the Next.js mocks). Tests live in `__tests__/` next to the package source.

```bash
pnpm --filter web test              # or any package: pnpm --filter @kit/branding test
pnpm --filter web test:coverage
```

Non-obvious bits:

- **`Cannot find module 'server-only'`** — alias it in that package's `vitest.config.ts`: `resolve.alias['server-only'] = './src/__mocks__/server-only.ts'`, where the mock is an empty `export {};`. Most packages already have one.
- **`vi.mock()` must appear before the import** of the module it mocks, or it won't apply.
- Per-test timeout override: `it('slow', async () => { ... }, { timeout: 10000 });`
- Never hit real APIs or depend on external state; mock Supabase, Redis, and HTTP.
- Coverage goals: 90%+ for core utilities, 85%+ for business logic, 80%+ for routes and server actions.

Reference implementations to copy from: `packages/branding/__tests__/color-utils.test.ts` (pure functions), `packages/next/__tests__/enhance-action.test.ts` (server actions), `packages/cache/src/__tests__/factory.test.ts` (factory/singleton pattern).

## Feature Specifications

Feature implementations must adhere to the specifications in the `specs/` folder:

- **Before implementing a feature**: Check if a spec exists in `specs/` for the feature (e.g., `specs/phase-5-audio-generation/providers/FILM-510-voice-cloning.md`)
- **During implementation**: Follow the database schema, API design, and component structure defined in the spec
- **After implementation**: Update the spec file to mark acceptance criteria as complete and change status to `✅ DONE`
- **Spec index**: See `specs/INDEX.md` for a complete list of all specifications and their status

When a spec exists for a feature, treat it as the source of truth for requirements, database schema design, and acceptance criteria.

## Episodes & Content Generation

A multi-stage AI content pipeline: ideation → story → screenplay → visual studio → audio studio, with scene-by-scene shot generation and VEO 3.1 prompts. Working under `packages/features/episodes` loads that package's `CLAUDE.md` with the pipeline conventions; see also its `README.md`.

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

After implementation, run the Code Quality commands above. If you implemented a feature from `specs/`, update the spec document to match any implementation changes.
