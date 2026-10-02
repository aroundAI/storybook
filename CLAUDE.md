This file provides guidance to Claude Code when working with code in this repository.

## Core Technologies

- **Next.js 15** with App Router
- **React 19**
- **TypeScript**
- **Tailwind CSS 4** and Shadcn UI
- **Turborepo** monorepo structure

## Communication

- Before starting a task, briefly state in one line what you are about to do.
- While working, provide brief progress updates when useful so the user can follow along.
- End every task with a short, self-contained recap covering:
  - What you found
  - What you changed
  - What happens next, if anything

## Tool Output

- Tool/command output is not necessarily visible to the user.
- If command output contains information the user needs to see, include the relevant information explicitly in your response.
- Do not assume the user can see tool output.

## File Editing

- Minimize the amount of text/tokens changed when editing files.
- Prefer surgical edits over rewriting an entire file when doing so does not affect the final result.
- Preserve existing formatting and unrelated content.

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
- **Storage**: Cloudflare R2 (zero egress; `STORAGE_PROVIDER` accepts only `r2` and `supabase`)
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
STORAGE_PROVIDER=r2          # Was: supabase
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
storybook/
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
pnpm --filter web dev       # Main app (port 3000) — ClickHouse OFF, like production
```

### Local Supabase + ClickHouse — both exist, use them

```bash
./scripts/local-env.sh up       # Supabase + ClickHouse 24.8 (CI's version) + CH migrations
./scripts/local-env.sh status   # confirm both are up
./scripts/local-env.sh verify   # every ClickHouse query, against the real server

# a server that actually reads ClickHouse (plain `pnpm dev` does not)
set -a; . deployment/config/local.env; set +a
cd apps/web && npx next dev --turbo -p 3100
```

**`CLICKHOUSE_ENABLED=false` is production's state, not your machine's.** When a
spec says analytics figures "cannot be verified", it means in production and CI.
Locally, seed ClickHouse rows with a hand-computed answer and read the figure
off the page — see "Local environment" in `docs/ENGINEERING-WORKFLOW.md` and
`apps/e2e/tests/experiments/experiments-evidence.spec.ts`. Reporting a value as
unverified while the container is running is a gap, not a limit.

### Database Operations

```bash
pnpm supabase:web:start     # Start Supabase locally
pnpm --filter web supabase migration up     # Apply new migrations
pnpm supabase:web:reset     # Reset with latest schema (clean rebuild)
pnpm supabase:web:typegen   # Generate TypeScript types
# NOTE: no `db diff` — see "Do not run supabase db diff" below
```

The typegen command must be run after applying migrations or resetting the database.

## Database Workflow - CRITICAL SEQUENCE ⚠️

When adding new database features, ALWAYS follow this exact order:

### ⛔ Do not run `supabase db diff` in this repo

**The database is built from `apps/web/supabase/migrations/`.** `supabase db
reset --help` says so in as many words: *"Resets the local database to current
migrations."* `apps/web/supabase/schemas/` is read by nothing: `config.toml`
points `schema_paths` at a glob that matches no file, so `db diff` stops with
"no files matched pattern" (KB-4). Deleting `schema_paths` would not do it — the
CLI then reads `supabase/schemas/` by default — and `db reset --experimental`
would build from it instead of `migrations/`.

And it has been left behind. Measured 2026-09-16:

```
tables in schemas/    : 66
tables in migrations/ : 99
missing from schemas/ : 33   # verified_facts, content_analytics, shorts, …
```

`db diff` generates the SQL that makes the database match `schema_paths`. Run
against a `schemas/` missing a third of the tables, that is a migration
proposing to **drop them**. Nobody has been bitten only because the shadow
database fails first, which is luck rather than a guard.

So: **write migrations by hand** (Method 2 below), and treat `schemas/` as
partial documentation that may be wrong. Update the schema file alongside a
migration when one exists for that table — it is still what most people read
first — but never generate from it, and never trust it over `migrations/`.
Restoring `db diff` means reconciling those 33 tables first; that is its own
piece of work.

### Method 2: Hand-written timestamped migration — the method here

1. **Write the migration** in `apps/web/supabase/migrations/`:
   ```bash
   timestamp=$(date -u +"%Y%m%d%H%M%S")
   $EDITOR "apps/web/supabase/migrations/${timestamp}_feature-name.sql"
   ```
2. **Apply it**: `pnpm --filter web supabase migration up`
3. **Mirror it** into `apps/web/supabase/schemas/XX-feature.sql` if that table
   has a schema file, so the two do not drift further
4. **Generate types**: `pnpm supabase:web:typegen` — and *generate* them, never
   hand-edit. CI regenerates and fails the build if the committed file differs
   ("Types are generated, not hand-written" in the Supabase DB job), because
   FILM-1608 shipped a spliced one. The command writes both copies; the CLI
   version is pinned in `apps/web/package.json` to match the one CI installs,
   so local and CI produce byte-identical output. If those two ever drift
   again, the generated file silently loses `SetofOptions` blocks — which is
   what types an `.rpc()` result as a row rather than an array.
5. **Verify types exist** before using them in code
6. **Cover RLS with a pgTAP test** in `apps/web/supabase/tests/database/` when
   the migration touches a policy. Policies are not verified by reading them —
   see `docs/ENGINEERING-WORKFLOW.md`

⚠️ Schema files alone don't create tables. Only a migration does.

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

**Run `pnpm format:fix` before every push.** CI's 💅 Format job fails a PR
with any file Prettier would change, so an unformatted push is a red build.

- **Rebasing an older branch onto `main`:** run `pnpm format:fix` on the
  branch *first*, commit, then rebase. A branch written before a reformat
  conflicts with `main` on every line both sides touched, often only in
  formatting (a reordered Tailwind class list). Formatted first, its lines
  already match `main`'s, and most of those conflicts disappear. If a
  rebase still stops on conflicts, resolve them, then run it again.
- **A rebase that only resolves a docs conflict doesn't re-run the suite.**
  When a push leaves the PR's code patch identical (same `git patch-id` over
  non-docs paths) and the previous head's run passed, 🔎 Changes reuses that
  verdict: the fast lane skips and 📚 Docs checks runs
  (`scripts/ci/code-patch-unchanged.sh`). Touch any code line in the same
  push and the fast lane runs. The PR's code on top of the *new* main is
  tested by its merge-queue run.
- **The merge queue is the gate** (2026-10-01). A PR run is the fast lane
  (🔎 Changes, ʦ TypeScript, 💅 Format, 🧪 Unit Tests, 🗄️ ClickHouse SQL, or
  📚 Docs checks); the heavy jobs (🧪 Unit guards, on six shards, and
  🐘 Supabase DB) run once, when the PR is queued, on main + the PR, and
  nothing runs after the merge. ⚫️ Test, 🧬 E2E evidence and 🧬 E2E guards
  run only in the nightly full run and on dispatch, not in the queue (owner,
  2026-10-02). The queue builds up to 10 entries at once. A stacked PR
  cannot share the queue with its parent: the parent's squash leaves the
  child UNMERGEABLE, so rebase the child onto main after the parent merges.
  The one required check is
  **✅ CI result**. Actions → Workflow → Run workflow runs the full suite on
  a branch on demand. `scripts/ci/minutes.sh <pr|run-id>` reports what a PR
  or run cost in runner-minutes.
- **Scoped heavy jobs are enforced** (`CI_SCOPE_HEAVY=true`, owner,
  2026-10-02, without the shadow week). In each queue run 🔎 Changes
  works out which heavy jobs the change needs (`scripts/ci/scope-heavy.sh`:
  Playwright when turbo's affected set reaches `web`/`web-e2e`, 🐘 Supabase
  DB for SQL, only the guards whose file or test changed via `run.py
  --changed`, everything on a root-config change). It writes what it *would*
  skip to the run summary and skips them. Unset the repo variable to run
  everything again. A nightly full run on main (02:30 UTC) catches anything
  scoping misses, and runs every 🧬 E2E guard.
- **Don't push while a run is in progress.** The push cancels it, and a
  cancelled run is still billed. Batch fixes into one push; queue a PR only
  when its fast lane is green.
- **Merges no longer force rebases for records.** INDEX.md stores no count
  (`pnpm specs:index` prints the totals), and a citation that only moved is a
  warning (`pnpm specs:citations --fix` re-points it); only cited text that
  is gone fails. Rebase when git reports a real conflict, not to recount.
- **No Actions minutes?** [LOCAL-CI.md](LOCAL-CI.md) is the fallback: the
  same jobs run locally (`scripts/local-ci/`) and a merge train merges only
  the exact commit it verified.
- **Use the script, not a bare `npx prettier`.** The script runs each
  package's own `format` with the shared config; a one-off run from one
  directory is how formatting used to differ by which file a run started
  with.
- **`format:fix` runs turbo with `--force`**, and must keep it. Turbo caches
  only Prettier's cache file, not the files it formats, so a cache hit
  replayed "done" and left files unformatted — reproduced: the same
  misformatted file was formatted on one run and left as it was on the
  next.

## Testing

This repository uses **Vitest 3.2.4** for unit and integration testing. Infrastructure is 100% complete with 62 tests passing across 2 packages.

### Quick Commands

```bash
# Run all tests for web app
pnpm --filter web test

# Run tests for specific package
pnpm --filter @kit/branding test

# Run with coverage report
pnpm --filter web test:coverage
```

### Test Infrastructure

**Configured packages**: @kit/branding, @kit/next, @kit/llm, @kit/cache (pre-existing)

**Locations**: `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts`, `apps/web/test/`, `packages/*/vitest.config.ts`, `packages/*/__tests__/`

**See [docs/TESTING.md](docs/TESTING.md)** for test structure, mocking patterns, troubleshooting, and the complete roadmap of remaining tests.

### E2E: when a unit test cannot see the bug ⚠️

**A form or interactive component needs a Playwright spec before its
acceptance criteria are ticked.** FILM-1609 went four review rounds on one
form while typecheck, lint and 256 unit tests stayed green, because every
defect lived between the DOM and form state:

| Defect | What made it invisible |
|---|---|
| `publishId: ''` against `.uuid().optional()` | Valid TypeScript; the resolver rejected it at runtime |
| `accountId` injected in `onSubmit` | `zodResolver` runs over form values *first*, so it never reached `onSubmit` |
| Unregistered amount input | `reset()` zeroed state while the DOM kept the text → a `0` row saved silently |
| Uncontrolled `Select` | Radix keeps the displayed value across `reset()` |

The rules, with `apps/e2e/tests/revenue/` as the worked example — full
detail in `apps/e2e/README.md`:

- **Seed through the API, not the UI.** `tests/utils/seed.ts` gives you
  `seedUser` and `seedTeamAccount`; `signInAs` in `tests/utils/session.ts`
  signs the fixture in. Driving sign-up, confirmation mail and the account selector
  first makes a test fail for reasons unrelated to its subject, and is ~20×
  slower (26s for eight specs, versus 90s timeouts).

  This is a rule with an edge, not a preference. **Three specs are exempt
  because auth is their subject** — `authentication/auth.spec.ts`,
  `authentication/password-reset.spec.ts` and
  `team-accounts/team-invitation-mfa.spec.ts`. Signing up through an
  invitation link is also legitimate where accepting the invite is the
  subject — "Full Invitation Flow" in `invitations.spec.ts` and
  `setupTeamWithMember` in `team-accounts.spec.ts`.

  Two places still sign up through the UI without that excuse, and should
  seed when next touched: the second user in `team-accounts.spec.ts`'s
  "unauthorized user cannot access team account", and
  `user-billing/user-billing.po.ts`. The billing one is unmigrated because
  billing specs are off locally and in CI (`ENABLE_BILLING_TESTS`), so a
  change there could not be run.

  It went unenforced long enough for four suites to ignore it, and the bill
  came due as a recurring red build: the admin suite drove a sign-up, a mail
  round trip, a sign-out, a sign-in and a TOTP challenge before every single
  assertion, and was marked `mode: 'serial'` to cope — which turned one
  rejected code into eight skipped tests. A measured run before the fix was
  5 failures and 8 skips; after, 29 passes and nothing skipped.

- **Authenticate once, not per test.** The super-admin session is captured by
  the `setup` project (`tests/auth.setup.ts`) and reused via `storageState`.
  It must be captured *after* MFA: `public.is_super_admin()` returns false
  unless the session is `aal2`, so a session that skipped the challenge gets
  a 404 that reads like a product bug.

- **`waitForTimeout` is not synchronisation.** It encodes how fast the machine
  that wrote it happened to be. Wait for the condition — a URL, an element, a
  value — and let the assertion retry. Every fixed sleep removed from the
  admin suite was hiding a question its author could have asked directly.
- **Assert the *second* submission.** State bugs are invisible on a fresh
  form; they appear after a reset when DOM and form state disagree.
- **Prove the guard fails without the fix.** Revert the fix, watch it go
  red, restore. A test that only ever passed on fixed code has proved
  nothing — this is the step that turns it into a regression test.
- **`data-test` on anything a test touches**, per the React guidance above.
- **`PLAYWRIGHT_BASE_URL`** points a run at a server other than whatever
  holds port 3000. A dev server left up for days goes stale and silently
  stops sending auth email, which looks exactly like a broken suite.

```bash
# run against your own server
PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test revenue

# regenerate PR screenshots (skipped in CI without the flag)
CAPTURE_EVIDENCE=1 EVIDENCE_DIR=/tmp/evidence npx playwright test revenue-evidence
```

### How work gets verified — read `docs/ENGINEERING-WORKFLOW.md`

**[docs/ENGINEERING-WORKFLOW.md](docs/ENGINEERING-WORKFLOW.md) is the canonical
process**: the six failure modes behind ten review rounds on one `S`-sized
spec, what each test layer can and cannot see, the sequence for a change, and
the pre-PR audit. (The doc carries the counts; this pointer deliberately does
not repeat them, because the two copies drifted apart within a day.)

Three rules from it are non-negotiable and repeated here because this file is
what gets read first:

1. **Red before green.** A guard that has never been seen to fail has proved
   nothing. Revert the fix, watch the test fail for the stated reason, restore.
2. **Execute before claiming.** "This should now work" is not a result. A form
   means driving the form; a CLI capability means running `--help`.
3. **Fix the class, not the instance.** After a fix, grep for its shape across
   the repo. If the same rule now lives in two places, make it one function.

And the question that would have caught the most: **what does my fix now allow
that it did not before?**

### Screenshots are required for UI changes

**A PR that changes what a user sees must show what they now see.** Not a
description of it, not a passing test name — the rendered result, in the PR,
before review.

This is a rule because of what it costs when it is skipped. FILM-1609 ran
**six review rounds** on one form. Every round was text-only: reading the
diff, reasoning about the types, running 256 green unit tests. The form
could not be submitted at all for two of those rounds, wrote `$0` rows over
real figures in a third, and turned a pasted `1,250.00` into `$1.00` in a
fourth. **A single screenshot of the form after a save would have ended it
at round one.** Nobody looked until round five.

What counts:

- **The state after the action, not just before it.** Most UI bugs in this
  repo have been reset-and-rerender bugs: a field that keeps its text while
  form state has moved on, a select that keeps its label. The first
  screenshot looks fine; the second is where the bug is.
- **The error states too.** A validation message that never renders is
  indistinguishable from one that does, in a diff.
- **Measurements for anything numeric.** "Looks right" is not a claim a
  reviewer can check. Read the value out of the DOM and put it in the
  comment as a table — see the FILM-1605 and FILM-1609 PR comments.

Generate them from a Playwright spec rather than by hand, so they can be
regenerated when the UI changes and so the states are the ones the tests
already assert — `apps/e2e/tests/revenue/revenue-evidence.spec.ts` is the
pattern, gated behind `CAPTURE_EVIDENCE=1` so CI pays nothing for it.

### Posting screenshots to a PR — `gh --attach` ⚠️

**`gh` uploads images directly. Do not claim otherwise.** The flag landed in
**gh 2.99.0** (this repo is on 2.100.0), and an assistant working from older
knowledge will confidently state that GitHub's `user-attachments` store is
web-upload only. It is not, and that claim cost a round trip here.

Supported on six commands: `gh issue create|edit|comment` and
`gh pr create|edit|comment`. Up to 50 files per command. Alt text goes after
a `#`; without one the filename is used.

```bash
gh pr comment 256 \
  --body-file body.md \
  --attach "/abs/path/02-blank-amount.png#The form refusing a blank amount" \
  --attach "/abs/path/04-after-save.png#Every field back to its default"
```

**The path in `--attach` must match the reference in the body, character for
character.** `gh` rewrites `![alt](<path>)` only where `<path>` is the exact
string passed to `--attach`; anything it cannot match is appended at the end
instead, leaving the inline reference dead. Passing `/abs/path/x.png` while
the body says `./x.png` produces five broken images *and* five appended
duplicates — use the same absolute path in both, or run from the directory
holding the files and use the same relative path in both.

Verify rather than assume, because a broken image renders as alt text and is
easy to miss:

```bash
gh pr view <n> --json comments \
  --jq '.comments[-1].body' | grep -oE '!\[[^]]*\]\([^)]+\)'
# every URL should be https://github.com/user-attachments/...
```

`--edit-last` amends your own most recent comment, so a botched attach is
fixable in place rather than by posting again.

## Feature Specifications

Feature implementations must adhere to the specifications in the `specs/` folder:

- **Before implementing a feature**: Check if a spec exists in `specs/` for the feature (e.g., `specs/phase-5-audio-generation/providers/FILM-510-voice-cloning.yaml`)
- **During implementation**: Follow the database schema, API design, and component structure defined in the spec
- **After implementation**: Update the spec file to mark acceptance criteria as complete and change status to `✅ DONE`
- **Spec index**: See `specs/INDEX.md` for a complete list of all specifications and their status
- **Known bugs** (FILM-CC-04): one file per bug in `specs/known-bugs/` — filing, fixing and numbering rules in its README; `pnpm specs:known-bugs` prints the open and fixed tables

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

Shot lists are generated scene by scene, in parallel. Screenplay generation
queues a `shot-generation` job (`generateShotListAction` or the bulk
actions), and the LLM worker runs it through the Shot Orchestrator:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│   1. CONTEXT (once)  apps/web/lambda/llm-worker/handlers/shot-generation.ts     │
│      buildEpisodeContext() → formatCharactersForVeoPrompt() / …LocationsFor…    │
├─────────────────────────────────────────────────────────────────────────────────┤
│   2. SHOT ORCHESTRATOR  runShotOrchestrator() — three agent skills:             │
│      Reel Scout (analyzeScenes)       → short-form candidate scenes             │
│      Shot Director (generateShots)    → executeLLM('scene-shot-generation')     │
│        once per scene, in parallel batches of 5 (3 above 15 scenes),            │
│        Promise.allSettled so one failed scene does not fail the batch;          │
│        shots numbered in order across scenes                                    │
│      Shot Quality (evaluateShotQuality) → post-generation quality gate          │
├─────────────────────────────────────────────────────────────────────────────────┤
│   3. STORE  the handler replaces the episode's shots in the shots table         │
└─────────────────────────────────────────────────────────────────────────────────┘
```

Every scene prompt carries the episode's full character and location
context; there is no per-scene context filtering (KB-122).

**Key files**:
- `apps/web/lambda/llm-worker/handlers/shot-generation.ts` - The job: context, orchestrator, storage
- `packages/features/episodes/src/agent/shot-orchestrator.ts` - Reel Scout → Shot Director → Shot Quality
- `packages/features/episodes/src/agent/skills/shot-director-skill.ts` - Per-scene parallel shot generation
- `apps/web/lambda/llm-worker/utils/context-builder.ts` - Episode context and VEO formatters
- `packages/features/episodes/src/lib/server/mutations/shot-list-actions.ts` - Queues the job
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

## Reading More Than 1000 Rows ⚠️

`apps/web/supabase/config.toml` sets `max_rows = 1000`, and **production enforces it for the service-role/admin client too**. PostgREST applies the cap by returning a **short body with HTTP 200 and `error: null`**, so a truncated read is indistinguishable from a complete one — there is no exception to catch and no flag to check.

```typescript
// ❌ WRONG - silently returns at most 1000 rows, no error
const { data } = await client.from('publishes').select('id').eq('status', 'published');

// ❌ ALSO WRONG - the server cap still applies; this can never return 5000
const { data } = await client.from('episodes').select('id').limit(5000);

// ✅ CORRECT - page until the result is exhausted
import { fetchAllRows } from '@kit/shared/pagination';

const rows = await fetchAllRows<{ id: string }>(
  (from, to) =>
    client
      .from('publishes')
      .select('id')
      .eq('status', 'published')
      .order('id')          // REQUIRED: a unique, deterministic order
      .range(from, to),
  'publishes',
);
```

**Always page a read whose correctness depends on seeing every row** — id lists feeding an aggregate, denominators, distinct-set derivations, anything written to ClickHouse. A display list that merely looks short is lower stakes, but paging it costs nothing.

- **`.order()` on a unique column is mandatory.** Range pagination over an unordered query can skip or repeat rows, because Postgres may return them in a different order per request.
- **`.in(...)` lists need `fetchAllByIds`, not just pagination.** A long filter list is serialized into the request URI and fails with a 414 — a separate ceiling that bites at a different threshold. This matters most on one-to-many tables (`publish_tags` has a row per assignment, so it truncates long before the publish count does).
- **`{ count: 'exact', head: true }` is not row-capped** — an exact count is safe unpaged, but chunk its `.in(...)` list and sum the results.

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

### Opening a pull request ⚠️

**A PR says what it does in its title, and updates that record in the same
PR.** The 2026-09-29 records audit found the specs lagging merged work:
FILM-1802 still said "not served" after #473 served it; KB-113, KB-125 and
FILM-1711 cited PRs that had merged into a dead branch instead of #422, the
one that reached main; KB-128 stayed open after the same bug was fixed as
KB-137. None of it was visible without reading every PR.

**Title: `type(IDS): what now happens, in plain words`**

- `type` is one of `feat`, `fix`, `docs`, `test`, `chore`, `ci`, `refactor`,
  `perf`, `build`, `revert`.
- `IDS` are the specs and known bugs this PR *does*, comma-separated:
  `fix(KB-60, KB-42): …`. One it only mentions stays out of the
  parentheses: `fix(KB-111): … (KB-114 filed)`. With no spec or KB, name the
  area: `chore(local-ci): …`.
- The summary says what is true afterwards, in plain words and the present
  tense: "a failed read says what failed", not "refactor error handling".
- **Markers**, at the end of the summary, only in these forms:

  | Marker | Means | Checked |
  |---|---|---|
  | `(closes FILM-x)` / `(closes KB-n)` | The spec becomes DONE, or the KB fixed | It must be in `(IDS)`, and the record must say DONE or fixed |
  | `(part N)` | One slice of a multi-PR spec: `(part C)`, `(part 2/4)` | Form only |
  | `(stacked on #N)` | Merges after #N; retarget to main once #N merges | Form only |
  | `(re-land of #N)` | Replaces a PR that merged into a dead branch | Its records cite this PR, as for any fix |

  Any other parenthesis is prose, like "(KB-114 filed)".

Read together, a title is an audit line: `fix(KB-113, KB-125): land the two
fixes on main (re-land of #395, #400) (closes KB-113)` says what kind of
change it is, which records must show it, what changed, and how it relates to
other PRs, before the description is opened.

**Records, in the same PR:**

- `feat(FILM-x)` / `fix(FILM-x)`: update FILM-x. Tick the criteria it meets
  with evidence, rewrite the reasons it changes, and cite `#<PR>`.
- `fix(KB-n)`: `status`, `fixed_in: ["#<PR>"]`, `fixed_summary` and the
  banner, as `specs/known-bugs/README.md` says.
- **Re-lands:** a PR merged into another branch never reached main. The
  records cite the PR that did: `"#422 (re-land of #395)"`.
- **Duplicates:** when a fix closes an older KB too, close that one pointing
  at the fix, and name it in the fix's banner.
- `docs`, `test`, `chore`, `ci`, `refactor`, `perf` and `build` owe no record
  unless they change a criterion.
- **INDEX.md: change the spec's row, nothing else.** It stores no count;
  `pnpm specs:index` checks the rows and prints the totals.
- **Citations:** one whose line only moved is a warning, re-pointed by
  `pnpm specs:citations --fix` when convenient; one whose cited text is gone
  fails, and is corrected by hand.

**Labels** mirror the title: `type: <type>`; `known-bug` when a KB is in the
scope; `spec` when a FILM spec is; `area: <area>` from that spec's phase.
Pass them to `gh pr create --label`, or let the checker add them. A PR
closed without merging gets `superseded` as well.

**Body:** What, Why, Evidence, and **Records updated**, listing the spec and
KB files the PR changes.
No "Generated with Claude Code" line: like the commits, the PR is the
owner's (2026-09-29).

```bash
gh pr create --base main --head feat/film-1802-x \
  --title "feat(FILM-1802): the sandbox serves X" \
  --label "type: feat,spec,area: vendor-sandbox" --body-file body.md

pnpm prs:records --pr <n>                 # this PR: title, IDs, records, labels
pnpm prs:records --pr <n> --apply-labels  # add the labels it is missing
pnpm prs:records --since 2026-09-22       # audit everything merged since a date
```

It is a CI step: 📋 PR records (`.github/workflows/pr-records.yml`) re-runs it
whenever the PR is pushed, retitled or relabelled, and local CI runs it, so a
gap fails the run. It is not a required check and must not become one: it
runs on PR events only (a merge group carries no PR number), so the merge
queue would wait for it forever; ✅ CI result is the one required check. Read
it on the PR before queueing. Run `pnpm prs:records --pr <n>` yourself before asking for a merge.
It exits non-zero on any gap, and PRs merged into a branch other than main
are skipped (their work reaches main in a later PR, which is the one checked).

### Commit messages ⚠️

**Every commit is authored as `Shauryadeep Chaudhuri <shaurya@aroundai.co>`,
and none carries a `Co-Authored-By: Claude …` trailer** (owner, 2026-09-29).
The repo's local git config sets the identity for every worktree; check it in
a fresh clone:

```bash
git config user.name  "Shauryadeep Chaudhuri"
git config user.email "shaurya@aroundai.co"
```

It was `t <t@t>`, and GitHub's squash merge turned each branch author and
trailer into a `Co-authored-by:` line on main: 158 commits since 2026-09-22
carry one. Main's history is not rewritten for it; new commits are right.

**The message:**

```
type(IDS): what now happens, in plain words        ← subject, ≤ 72 characters

Why the change was needed, and what it found: the cause, not a list of
files. Wrap at 72. Name the specs, KBs and PRs it touches (#422, KB-128).
```

- The subject follows the PR title's rule: the same `type` list, and `IDS`
  are the specs or KBs this commit *does*. A PR squashes to its title, so
  the commits on a branch are read by reviewers, not by `git log` on main.
- One logical change per commit. A follow-up in the same PR says what it
  fixed ("the cover file input stays bare — setInputFiles needs the hidden
  element"), not "fix tests" or "address review".
- No trailers but the ones git or a tool needs (`Refs: #123` is fine).

`pnpm prs:records --pr <n>` checks every commit in the PR: its author, the
trailer, and the subject. An audit (`--since`) checks commits too with
`--commits`.

## Verification Steps

After implementation:
1. **Run `pnpm typecheck`** - Must pass without errors
2. **Run `pnpm lint:fix`** - Auto-fix issues
3. **Run `pnpm format:fix`** - See Code Quality section above; CI's 💅 Format job fails if Prettier would change a file
4. **Verify spec compliance** - If implementing a feature from `specs/`, ensure the spec document is updated to match any implementation changes, citing the PR; `pnpm prs:records --pr <n>` checks it. See [Opening a pull request](#opening-a-pull-request-)
5. **Screenshot every UI change in the PR** - Required, not optional. See
   [Screenshots are required for UI changes](#screenshots-are-required-for-ui-changes)