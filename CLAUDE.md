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
│   │   └── team-accounts/    # Team workspace management
│   ├── billing/              # Payment & subscription handling
│   ├── analytics/            # Analytics integration
│   ├── cache/                # Cache abstraction layer
│   ├── cms/                  # CMS integration (Keystatic)
│   ├── database-webhooks/    # Database event handlers
│   ├── email-templates/      # React Email templates
│   ├── i18n/                 # Internationalization
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

1. **Create/modify schema file** in `apps/web/supabase/schemas/XX-feature.sql`
2. **Generate migration**: `pnpm --filter web supabase:db:diff -f <migration_name>`
3. **Apply changes**: `pnpm --filter web supabase migration up` (or `pnpm supabase:web:reset` for clean rebuild)
4. **Generate types**: `pnpm supabase:web:typegen`
5. **Verify types exist** before using in code

⚠️ **NEVER skip step 2** - schema files alone don't create tables! The migration step is required to apply changes to the database.

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