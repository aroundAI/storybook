---
spec_id: FILM-1804
title: Sandbox-Backed E2E Flows
status: DRAFT
effort: L
dependencies: FILM-1802, FILM-1803
---

# Sandbox-Backed E2E Flows

## 1. Overview

Playwright specs for the product surfaces that have no E2E coverage today, driven
against the sandbox instead of seeded rows. Today's suite covers auth, teams,
billing, admin and the analytics tabs. Nothing drives:

- platform connect (`/home/[account]/settings/platforms`), token refresh, disconnect;
- publishing an episode, or social posts;
- project creation, or any studio stage (ideation, story, screenplay, visual studio,
  audio studio, shorts studio, edit suite);
- analytics for a channel the app synced itself, rather than one seeded into ClickHouse.

## 2. The flows

| Flow | What it proves |
|---|---|
| **Connect**, one per platform | The real `/api/platforms/connect/<p>` → sandbox consent → `/callback/<p>` round trip stores an encrypted, scoped connection. Today's UI lists only YouTube, TikTok, Instagram and Facebook (`platform-connections.tsx`); X and LinkedIn have routes but no button, and the spec records that rather than assuming a button |
| **Disconnect and reconnect** | Revoke reaches the vendor; the second connect is a fresh grant. The *second* submission, per the E2E rules |
| **Token refresh** | A near-expiry token is refreshed by the real cron route; X, which has no refresh path today, is recorded as a known gap, not asserted to work |
| **Publish** | An episode published to a sandbox channel gets a vendor ID and reaches `published` through the vendor's status sequence |
| **Sync to dashboard** | After the analytics sync, the dashboard shows exactly what the ledger says was served — per platform, including the zero-versus-absent distinctions phase 17 cares about |
| **Studio pipeline** | Ideation → story → screenplay → shot list → audio, for every stage FILM-1803's inline-vs-enqueued list marks reachable |
| **Vendor errors** | With `POST /__sandbox/fail`, a rate limit, an expired token and a 5xx each produce the product's intended message, not a blank or a crash |

## 3. Asserting against random data

The sandbox is random per run (FILM-1802 §4), so no test writes a number in
advance. Every figure is asserted **against the ledger**: read what the sandbox
served for that object, then read the page, and they must agree. A helper in
`apps/e2e/tests/utils/sandbox.ts` wraps the control API — `ledgerFor(objectId)`,
`servedTotals(objectId)`, `failNext(endpoint, n, error)`, `reset()`.

A failing run prints the sandbox seed, so `SANDBOX_SEED=<n>` replays it exactly.

## 4. Two regression tests that must exist

- **Instagram Reels (#278).** A Reel synced from the sandbox stores its real share
  count, and the sandbox's ledger shows no `/insights` call with a `breakdown`
  Meta does not document for media (it answers one with Meta's error, per
  FILM-1802 §3). Against the code before #278 this fails.
- **TikTok success envelope (#279).** A TikTok video synced from the sandbox stores
  its counts and records no error. Against the code before #279 this fails.

Both are recorded as mutation-guard entries (`kind: e2e`), per
`tooling/mutation-guards/README.md`: revert the fix, the flow goes red.

## 5. Rules carried over from the suite

From `apps/e2e/README.md` and `docs/ENGINEERING-WORKFLOW.md`:

- Seed accounts through the API (`seedUser`, `seedTeamAccount`); drive the vendor
  through the sandbox, not by inserting `platform_connections` rows. That insert
  (`seedYouTubeConnection`) remains for specs whose subject is not connect.
- Assert the second submission, not only the first.
- Prove each guard fails without its fix.
- `data-test` on anything a test touches.
- Run against `test:prod` before claiming the suite is fine.

## 6. Where they run

Locally, with `local.env` loaded and the sandbox up. **CI**: the sandbox is a plain
Node process, so the E2E jobs can start it the way they start ClickHouse today — a
step before the app server. CI has no `local.env` (it lives in the private
`deployment/config` submodule, which CI does not check out), so the job sets
`VENDOR_SANDBOX` and the `VENDOR_URL_*` values in its own `env:`. Whether to add it to CI, and to which job, is decided
when the first flow lands; until then these are gated behind `SANDBOX_E2E=1`, the
way ClickHouse evidence is gated behind `CLICKHOUSE_EVIDENCE`.

## 7. Acceptance criteria

- [ ] Every flow in §2 has a spec, or a written reason it cannot run yet
- [ ] No spec in this set asserts a hardcoded metric value; every figure is compared with the ledger
- [ ] The #278 and #279 regression flows exist, and each goes red with its fix reverted
- [ ] Each vendor error path in §2 renders the product's intended message
- [ ] A failed run prints the sandbox seed, and replaying it reproduces the failure
- [ ] `apps/e2e/README.md` documents the sandbox helpers and `SANDBOX_E2E`

## 8. Verification

The flows themselves, run locally against `test:prod`, and the mutation-guard entries
run with `--kind e2e`.

## 9. Risk

**Flakiness from real-time growth.** Data changes while a test runs. Ledger-based
assertions read what was served for the request the page made, so growth between the
request and the assertion does not matter; a test that instead re-reads current
state is the bug to avoid, and the helper does not offer it.
