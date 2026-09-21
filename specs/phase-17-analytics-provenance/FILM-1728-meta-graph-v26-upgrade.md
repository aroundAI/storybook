---
spec_id: FILM-1728
title: Meta Graph API — Upgrade the Pin to v26.0
status: DRAFT
effort: S
dependencies: FILM-1723; FILM-1712 if it lands first (same Instagram insights requests)
---

# Meta Graph API — Upgrade the Pin to v26.0

## 1. Why this exists

[FILM-1723](./FILM-1723-api-version-consolidation.md) replaced three Graph
versions — two of them expired, all of them silently served as `v20.0` — with one
constant, `META_GRAPH_VERSION`, and pinned it to **`v23.0`**.

That choice was deliberate and was the right one *for that change*. FILM-1723
shipped against a deadline (`v20.0` expired 2026-09-24), and `v23.0` was the only
version this repository had already chosen and run in production, so Instagram
insights requests stayed byte-identical and the token-refresh path moved the
shortest distance from what Meta was actually serving.

It is not the right place to stay. `v23.0` was released 2025-05-29 and is already
three versions behind; `v26.0` (released 2026-07-29) is the latest. The owner's
decision on 2026-09-22 was to take the safe pin first and **move to `v26.0` as its
own change**, where the changelog reading and the verification are the whole
subject rather than a rider on an urgent fix. This spec is that change.

**What FILM-1723 made cheap.** The bump itself is three constants and one
documentation row. Everything else in this spec is the part that is not cheap:
knowing what `v24.0`, `v25.0` and `v26.0` changed under the calls we make.

## 2. What changes

| | From | To |
|---|---|---|
| `META_GRAPH_VERSION` | `v23.0` | `v26.0` |
| `META_GRAPH_VERSION_RELEASED` | `2025-05-29` | `2026-07-29` |
| `META_GRAPH_VERSION_EXPIRES` | `2027-10-08` | from Meta's changelog — see §3 |

All three live in `packages/shared/src/vendors/meta.ts`. The row and the "Pinned"
line under *Graph API versions* in
[`docs/platform-capability-reference.md`](../../docs/platform-capability-reference.md)
change with them; `packages/shared/__tests__/vendor-api-versions.test.ts` fails
until the constant, the line and the row agree, and fails on a version literal
written anywhere else. **No call site changes.** If one has to, that is a finding
(§4), not a routine edit.

## 3. The expiry date is a fact to fetch, not to infer

The reference records `v26.0`'s expiry as **TBD** — Meta had not published it when
FILM-1721 and FILM-1723 measured. Meta's guarantee is "at least two years from
release", which puts it no earlier than 2028-07-29.

- Read the expiry from
  [Meta's changelog](https://developers.facebook.com/docs/graph-api/changelog/) on
  the day this is implemented.
- If it is still unpublished, record `META_GRAPH_VERSION_EXPIRES` as the guaranteed
  floor (`2028-07-29`), and say in the constant's comment and the reference row
  that it is **the guaranteed minimum, not the published date**. The binding test
  must accept that state explicitly rather than by accident — an inferred date
  dressed as a documented one is the failure FILM-1721 exists to prevent.

## 4. Read every changelog crossed — v24.0, v25.0, v26.0

For each of the three versions, read the Graph API *and* the Instagram Platform
changelog, and record in this spec (a table in a new §9, in the manner of
FILM-1723 §10) what each changes on the surfaces this repository calls:

| Surface | Where it is called |
|---|---|
| OAuth dialog, code exchange, long-lived token exchange | `packages/features/publishing/src/oauth/meta/config.ts` |
| Token refresh, `/me/accounts` | `packages/features/publishing/src/lib/token-refresh.ts` |
| Page video publishing (incl. `graph-video` host) | `packages/features/publishing/src/providers/facebook/`, `apps/web/lambda/publish-worker/handlers/facebook.ts` |
| Instagram container create / status / publish | `packages/features/publishing/src/providers/instagram/instagram-provider.ts`, `apps/web/lambda/publish-worker/handlers/instagram.ts` |
| Instagram media and account insights | `packages/features/content-analytics/src/providers/instagram/instagram-insights.ts` |

Three things to look for specifically:

1. **Removed or renamed insights metrics.** Each removal goes into the forbidden
   block of the capability reference *before* the pin moves, so
   `platform-field-names.test.ts` proves nothing we request is among them. FILM-1723
   did this for `video_views` (removed in v21.0); do the same for anything v24–v26
   remove.
2. **The 2026-04-22 Instagram fields** ([FILM-1725](./FILM-1725-deferred-vendor-verifications.md)
   Check C asks whether they come back *on our pinned version*). Moving the pin
   changes the version that question is about. Update Check C's wording to `v26.0`;
   if the changelog settles it outright for v26.0, say so there.
3. **Permission or scope changes** on `/me/accounts`, `instagram_basic`,
   `instagram_manage_insights`, `pages_read_engagement`. A scope change belongs to
   [FILM-1711](./FILM-1711-analytics-authorisation.md)'s audit — report it there
   rather than widening the consent screen from this spec.

**If FILM-1712 (metric recovery) has landed**, the insights requests are no longer
the ones FILM-1723 reasoned about: re-check every newly requested field against
v26.0. If it has not landed, note in FILM-1712 that it must be written against
v26.0.

## 5. Verification

- **The pin is honoured.** `curl -sI "https://graph.facebook.com/v26.0/me" | grep -i
  facebook-api-version` returns `v26.0`. (Measured 2026-09-21: it does. Re-run on
  the day; it costs nothing.)
- **Red before green.** Bump only the constant → `vendor-api-versions.test.ts`
  fails naming the reference row. Bump only the row → it fails naming the constant.
  Then both. Add the bump to `tooling/mutation-guards/` alongside FILM-1723's
  entries.
- **The bundle carries one version.** Bundle the publish lambda as SST does
  (FILM-1723's esbuild check) and confirm exactly one `"v26.0"` and no other Graph
  version literal. `apps/web/lambda/` is not typechecked by any tsconfig, so the
  bundle is the evidence.
- **A live token refresh — deferred, and said so.** No Meta connection exists
  outside production. FILM-1725 **Check D** (one forced refresh at the first deploy
  carrying FILM-1723) must be **re-run at the first deploy carrying this change**;
  amend Check D to say so. Until then the criterion below stays unticked. If Check D
  has not yet been run for v23.0 when this ships, one run against v26.0 closes both.

## 6. Out of scope

- Any new metric, field or scope. This spec moves a version; FILM-1711 and
  FILM-1712 own what is requested.
- Facebook analytics ([FILM-1720](./FILM-1720-facebook-analytics.md)). It depends
  on FILM-1723 and should be **written against whichever pin is on `main`** when it
  starts; if this spec lands mid-flight, FILM-1720 re-checks its field list against
  v26.0.
- The vendor base-URL resolver
  ([FILM-1801](../phase-18-local-vendor-sandbox/FILM-1801-vendor-base-url-resolver.md)).
  It edits the `*_HOST` constants in the same file, this spec edits the
  `META_GRAPH_VERSION*` constants — adjacent lines, no shared ones.

## 7. Acceptance criteria

- [ ] `v24.0`, `v25.0` and `v26.0` changelogs (Graph API and Instagram Platform) read, and their effect on each surface in §4 recorded in this spec
- [ ] Every insights metric removed in v24–v26 is in the capability reference's forbidden block, and `platform-field-names.test.ts` passes
- [ ] `META_GRAPH_VERSION`, `_RELEASED`, `_EXPIRES` updated together; expiry is Meta's published date, or the guaranteed floor **labelled as such**
- [ ] *Graph API versions* in the capability reference updated; `vendor-api-versions.test.ts` seen red on a half-bump, then green
- [ ] No Graph version literal outside `packages/shared/src/vendors/meta.ts`; the bundled publish lambda contains exactly one, `v26.0`
- [ ] `facebook-api-version: v26.0` confirmed by the header probe on the day
- [ ] FILM-1725 Check C re-worded for v26.0; Check D amended to require a re-run on this deploy
- [ ] Token refresh verified against a live Meta connection on v26.0 (FILM-1725 Check D — expected to remain open until first deploy)

## 8. Risk

**Low, and concentrated in one place: token refresh.** A refresh that breaks does
not fail loudly on the day — long-lived Meta tokens last ~60 days, so connections
decay one at a time weeks later, and read as users "disconnecting". That is why
Check D is a deploy-day action and not a nicety.

Rolling back is the same three constants. Because every call reads the one
constant, a rollback cannot be partial — which was not true before FILM-1723.

**Do not schedule this inside the FILM-1723 deploy.** Land and deploy the v23.0
pin first; it is the change with a deadline. This one has none until 2027-10-08.
