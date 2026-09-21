---
spec_id: FILM-1801
title: Vendor Base-URL Resolver
status: DRAFT
effort: L
dependencies: none; do with or after FILM-1723 (same files)
---

# Vendor Base-URL Resolver

## 1. Why this exists

A local sandbox is useless if the app cannot be pointed at it. Today it cannot.
Every social platform and most AI vendors are reached through `https://` literals,
and the same host is often written in several places:

| Vendor | Where the host is written today |
|---|---|
| Meta Graph (Facebook, Instagram) | `publishing/src/oauth/meta/config.ts:7-9`, `publishing/src/providers/facebook/types.ts:90-91`, `publishing/src/providers/instagram/instagram-provider.ts:10`, `content-analytics/src/providers/instagram/instagram-insights.ts:15`, `publishing/src/lib/token-refresh.ts:432,475`, `apps/web/lambda/publish-worker/handlers/{facebook,instagram}.ts`, `apps/web/app/api/platforms/callback/meta/route.ts` |
| TikTok | `publishing/src/oauth/tiktok/config.ts`, `publishing/src/providers/tiktok/tiktok-provider.ts:12`, `content-analytics/src/providers/tiktok/tiktok-analytics.ts`, `publishing/src/lib/token-refresh.ts:379`, `publishing/src/oauth/tiktok/refresh.ts`, `apps/web/lambda/publish-worker/handlers/tiktok.ts` |
| X | `publishing/src/oauth/twitter/config.ts`, `publishing/src/providers/twitter/twitter-provider.ts:12-13`, `apps/web/lambda/publish-worker/handlers/twitter.ts` |
| LinkedIn | `publishing/src/oauth/linkedin/config.ts`, `publishing/src/providers/linkedin/linkedin-provider.ts`, `publishing/src/lib/token-refresh.ts:527`, `apps/web/lambda/publish-worker/handlers/linkedin.ts`, `apps/web/lambda/publish-worker/index.ts` |
| Google OAuth | `publishing/src/oauth/youtube/config.ts`, `publishing/src/lib/token-refresh.ts:336`, `apps/web/app/api/platforms/callback/youtube/route.ts` |
| YouTube Data / Analytics / Reporting | SDK defaults in `googleapis` and `@googleapis/youtube` — never given `rootUrl` |
| ElevenLabs, PlayHT, Suno, Udio | `audio-generation/src/lib/constants.ts` and providers accept a `baseUrl` option that `config-loader.ts` never fills; ElevenLabs is also hardcoded in `apps/web/lambda/voice-worker`, `apps/web/lambda/llm-worker` and server actions |
| DeepSeek | `packages/llm/src/providers/deepseek.ts` passes a hardcoded `baseURL`, which beats `OPENAI_BASE_URL` |
| Voyage, OpenAI embeddings (raw) | `packages/features/embeddings/src/voyage-client.ts`, `audio-generation/src/lib/audio-embedding.ts` |

This spec makes every one of them resolvable through one function, overridable in
local development only.

It is the same edit FILM-1723 makes for API **versions** — one pinned version per
vendor, currently v18.0, v19.0 and v23.0 for Graph alone. Doing the two separately
rewrites the same lines twice.

## 2. The shape

```ts
// packages/shared/src/vendors/index.ts — pure, no server-only imports
export const VENDORS = {
  'meta-graph':       'https://graph.facebook.com',
  'meta-oauth':       'https://www.facebook.com',
  'tiktok':           'https://open.tiktokapis.com',
  'tiktok-oauth':     'https://www.tiktok.com',
  'x-api':            'https://api.twitter.com', // FILM-1723 moves X to api.x.com
  'x-upload':         'https://upload.twitter.com',
  'x-oauth':          'https://twitter.com',
  'linkedin-api':     'https://api.linkedin.com',
  'linkedin-oauth':   'https://www.linkedin.com',
  'google-oauth':     'https://accounts.google.com',
  'google-token':     'https://oauth2.googleapis.com',
  'google-apis':      'https://www.googleapis.com',   // googleapis rootUrl
  'elevenlabs':       'https://api.elevenlabs.io',
  // …one entry per host in §1
} as const;

export type Vendor = keyof typeof VENDORS;

export function vendorUrl(vendor: Vendor): string;
```

- **Override**: `VENDOR_URL_<NAME>` (e.g. `VENDOR_URL_META_GRAPH`), honoured only
  under §3's conditions.
- **Versions stay separate.** `vendorUrl('meta-graph')` returns a host;
  `${vendorUrl('meta-graph')}/${GRAPH_VERSION}` composes it with FILM-1723's pinned
  version. The sandbox then serves every version path, which is itself a check that
  nothing pins a stray one.
- **SDKs**: `googleapis` and `@googleapis/youtube` each get `rootUrl` from the
  resolver (they ship separate copies of `googleapis-common`, so a global option on
  one does not reach the other). DeepSeek's hardcoded `baseURL` is replaced. The
  audio providers' existing `baseUrl` option is finally wired.
- **Browser-facing URLs.** OAuth *authorize* URLs are followed by the user's
  browser, so the override for those must be reachable from the browser —
  `http://localhost:4101`, not a container hostname.

## 3. It must not reach production

An override is honoured only when **both** hold:

1. `process.env.NODE_ENV !== 'production'`, and
2. `process.env.VENDOR_SANDBOX === '1'`.

Otherwise `vendorUrl` returns the real host and ignores `VENDOR_URL_*` entirely. On
top of that, at server start in production, any `VENDOR_URL_*` present in the
environment is **logged as an error and ignored** — a misconfigured deploy
degrades to the real vendor, never to a dead loopback address.

The lambdas under `apps/web/lambda/*` are production-only and never local; they use
the resolver so the literal disappears, but they will never see the override.

## 4. The guard

A repo-scan test in the shape of
`packages/features/content-analytics/__tests__/platform-field-names.test.ts`:

- **No vendor host literal outside the resolver.** Every host in `VENDORS` is
  searched for across `packages/` and `apps/`, excluding tests and the resolver
  itself. A match fails with the file and line and names the `vendorUrl()` call to
  use.
- **The host list is read from the resolver**, not restated, so adding a vendor
  there extends the guard automatically.
- **Production fails closed.** A unit test sets `NODE_ENV=production`,
  `VENDOR_SANDBOX=1` and `VENDOR_URL_TIKTOK=http://localhost:4102`, and asserts the
  real host comes back.

Both get entries in `tooling/mutation-guards/film-1801.json`: re-add a literal host
in a provider (must go red), and make the resolver honour an override in
production (must go red).

## 5. Out of scope

- The sandbox itself — FILM-1802, FILM-1803.
- Choosing which API version each vendor pins — FILM-1723.
- Stripe, Lemon Squeezy, S3/R2/B2, SES, SQS, Sentry: already avoided locally
  (`apps/web/next.config.mjs` aliases Stripe and Sentry in development; storage is
  Supabase; mail goes to Inbucket) or env-overridable by their SDKs.

## 6. Acceptance criteria

- [ ] Every host in §1 is reached only through `vendorUrl()`; the guard finds no literal
- [ ] `googleapis` and `@googleapis/youtube` both take `rootUrl` from the resolver
- [ ] DeepSeek's hardcoded `baseURL` and the audio providers' unwired `baseUrl` are replaced by the resolver
- [ ] OAuth authorize, token, refresh and revoke URLs all resolve through it, for all five social platforms
- [ ] An override is honoured only with `NODE_ENV !== 'production'` and `VENDOR_SANDBOX=1`
- [ ] In production a `VENDOR_URL_*` is logged as an error and ignored, never used
- [ ] With no override set, every request goes to exactly the host it went to before — verified by comparing the resolved URL of every call site before and after
- [ ] Both mutation guards go red

## 7. Verification

- `pnpm --filter @kit/shared test` and the guard test.
- A before/after table of every call site's resolved URL with no override set —
  they must be byte-identical. This is the check that the refactor changed nothing
  in production.
- With `VENDOR_SANDBOX=1` and one override, one real request per vendor lands on a
  local listener (`nc -l` is enough before FILM-1802 exists).
- `pnpm --filter web build:test` and a production `next build` both pass.

## 8. Risk

**A refactor of every outbound call is the kind of change that breaks production
quietly.** The before/after URL table in §7 is the mitigation, and it must be
produced, not assumed.

**The override becoming a production foot-gun** is what §3's double condition and
fail-closed logging exist for. The mutation guard proves the condition is load-bearing.
