# Phase 18: Local Vendor Sandbox

Local development can reach Supabase and ClickHouse and nothing else. Every
social platform, OAuth provider and AI vendor the product depends on is a
hardcoded `https://` host, so on a laptop those flows either hit the real vendor
with real credentials or do not run at all. This phase puts a faithful, stateful,
randomized stand-in for each of them on local ports, and uses it for end-to-end
tests that drive the flows seeding cannot reach.

## The problem, in one table

Measured 2026-09-21, from the code:

| | Today | Consequence |
|---|---|---|
| Vendor hosts | ~30 vendors, reached through hardcoded `https://` strings copied across `publishing/src/oauth/*`, `publishing/src/providers/*`, `lib/token-refresh.ts`, `content-analytics/src/providers/*`, `apps/web/lambda/publish-worker/handlers/*` and the connect/callback routes | Nothing can be pointed at a mock without editing code |
| Overridable today | Only the LLM SDKs (`OPENAI_BASE_URL`, `ANTHROPIC_BASE_URL`, `GOOGLE_GEMINI_BASE_URL`), AWS, lip-sync (`SYNCLABS_BASE_URL`, `WAV2LIP_API_URL`), SMTP, ClickHouse, Redis | The AI half is partly reachable; the social half is not |
| OAuth connect | No dev path. E2E inserts `platform_connections` rows directly (`apps/e2e/tests/utils/seed.ts:188` calls the flow "an entire external round trip") | Connect, token refresh and disconnect are never exercised before production |
| E2E coverage | Auth, teams, billing, admin, and the analytics suite | No spec for project creation, any studio stage, assets, canon, publishing, platform connect or social posts |
| Local analytics | Seeded ClickHouse; `seed-local-analytics.ts` writes every metric row as `platform: 'youtube'`, TikTok and Instagram publishes included | TikTok and Instagram analytics are never seen locally as they would arrive |
| User docs | `docs/PRODUCT_DOCUMENTATION.md` and `apps/web/content/documentation/*` describe connect paths and menus that do not exist | A new user is told to click things that are not there |

The cost is not hypothetical. Two defects found in the review of #277 passed every
unit test because each test mocked what the code expected rather than what the
vendor sends: Instagram's Reels branch never ran (`media_type` is never `REELS`,
#278), and every successful TikTok response was treated as a failure (#279). A
faithful local vendor shows both on the first sync.

## Specs and dependency order

```
FILM-1801 (base-URL resolver) ── prerequisite; coordinate with phase-17 FILM-1723
   ├─→ FILM-1802 (social platform sandbox) ← also FILM-1721 (the capability reference)
   └─→ FILM-1803 (AI generation sandbox)
            │
FILM-1802 + FILM-1803 ─→ FILM-1804 (sandbox-backed E2E flows)
```

| Spec | Status | Effort | Covers |
|------|--------|--------|--------|
| [FILM-1801](./FILM-1801-vendor-base-url-resolver.md) | DRAFT | L | One resolver for every vendor host; env overrides in local dev only; fails closed in production; a guard against new hardcoded hosts |
| [FILM-1802](./FILM-1802-social-platform-sandbox.md) | DRAFT | XL | YouTube, TikTok, Meta (Facebook + Instagram), X, LinkedIn: OAuth, refresh, publishing, analytics — stateful, randomized, growing over time |
| [FILM-1803](./FILM-1803-ai-generation-sandbox.md) | DRAFT | L | LLM (OpenAI, Anthropic, Gemini), audio (ElevenLabs, PlayHT, Suno, Udio, Sync Labs), embeddings (Voyage, OpenAI) |
| [FILM-1804](./FILM-1804-sandbox-backed-e2e-flows.md) | DRAFT | L | Connect, publish, sync-to-dashboard, token refresh, and one pass through the studio pipeline — asserted against the sandbox's ledger |

**Scheduling.** This phase touches the same provider files as phase 17's FILM-1711,
FILM-1712, FILM-1720 and FILM-1723. FILM-1801 in particular rewrites the host
constants that FILM-1723 consolidates to one pinned version per vendor — **do those
two together, or FILM-1723 first**; doing them separately edits the same lines twice.
FILM-1802 onward can run in parallel with phase 17, and makes phase 17's provider
work testable locally for the first time.

## Locked decisions

**Fidelity over convenience.** The sandbox returns only fields that
`docs/platform-capability-reference.md`'s field index documents for that endpoint,
and reproduces every documented quirk — TikTok's `error.code: "ok"` success
envelope, Instagram `media_type` never being `REELS`, account `views` being
`total_value`-only, an empty data set rather than `0`, X's 30-day wall from post
creation, TikTok data freezing 365 days after publish, YouTube's 48–72 hour
processing delay, the Reporting API's 30-day backfill. A permissive mock is worse
than none: it certifies code against a vendor that does not exist, which is how
#278 and #279 shipped green.

**It enforces the documented scopes.** A connection without TikTok's `video.list`
gets TikTok's authorisation error, not data. Phase 17's authorisation gaps
(FILM-1711) must show up locally, not be papered over by a generous stand-in.

**Random, but assertable.** Data is freshly random on every run. Each run draws a
seed and logs it, so a failure can be replayed by setting it. Tests never assert
fixed numbers; they assert that **the page shows what the sandbox served**, read
from the sandbox's ledger. Randomness and exact assertions are not in conflict.

**Content ages fast; the calendar stays real.** The app server's clock cannot be
accelerated — its date windows, 30-day walls and `snapshot_date` all use real
dates. So `SANDBOX_SPEED` accelerates each object's *growth curve*, not the
calendar: at real time *t* an object reports `curve(speed × (t − published))`, and
daily series stay on real dates with each day holding the curve's increase within
it. Totals stay monotonic and dailies still sum to totals. The visible cost —
history concentrated into recent real days — is stated, not hidden.

**It cannot reach production.** Overrides resolve only when
`NODE_ENV !== 'production'` **and** `VENDOR_SANDBOX=1`. A production build fails
closed on a loopback vendor URL. The sandbox app is never deployed.

## Known limits — do not promise these

- **Vendor acceptance.** The sandbox proves our side of each contract against the
  documented shape. Whether the real vendor accepts a request is still settled only
  by a real call (phase 17's FILM-1725).
- **Video generation.** There is no video-generation client to point anywhere —
  `packages/features/jobs/src/workers/manager.ts:44-50` is a stub. Nothing to mock
  until one exists.
- **SQS-backed workers.** The LLM, voice, render and email workers consume SQS
  queues with no local equivalent; their senders fail without queue URLs. Flows that
  depend on them are out of reach until a local queue exists, and FILM-1803 lists
  which studio stages that excludes.
- **Real-world benchmarks.** Sandbox numbers are random draws from invented curves.
  They are fit for exercising the product, never for telling a creator what "good"
  looks like.

## Later, not a spec: the user guide

Once this phase is done, the user guide is a one-time pass by an AI agent that
discovers the product's flows, runs them locally against the sandbox, and writes the
guide — flows, personas (`specs/PRD.md` §3) and screenshots. It is deliberately not
specified here. Two constraints carry over to whenever it happens: sandbox figures
are simulated and must be captioned as such, and advice on succeeding on social makes
no causal claim that an experiment in the product has not supported. The stale
`docs/PRODUCT_DOCUMENTATION.md` and `apps/web/content/documentation/*` are what that
pass replaces.
