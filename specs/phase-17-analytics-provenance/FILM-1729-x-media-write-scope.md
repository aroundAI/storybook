---
spec_id: FILM-1729
title: X Video Publishing — the `media.write` Scope
status: ⏸️ DEFERRED
effort: S
dependencies: FILM-1723; an X developer app with pay-per-use credentials (not held)
---

# X Video Publishing — the `media.write` Scope

## 1. Why this exists

[FILM-1723](./FILM-1723-api-version-consolidation.md) moved X video upload from
the retired v1.1 endpoint on `upload.twitter.com` to `/2/media/upload` on
`api.x.com`. The v2 endpoint demands the **`media.write`** scope of an OAuth 2.0
user token. `TWITTER_OAUTH_CONFIG.scopes`
(`packages/features/publishing/src/oauth/twitter/config.ts`) requests
`tweet.read`, `tweet.write`, `users.read` and `offline.access` — not
`media.write`. So a video publish to X is refused with a 403.

**This is not a regression.** The v1.1 endpoint never accepted OAuth 2.0 user
tokens at all, so X video publishing did not work before FILM-1723 either.
FILM-1723 replaced a call that could not succeed with one that can, once the
scope is granted, and made the refusal name the missing scope.

**It was unowned.** FILM-1723 §6 excludes scope changes.
[FILM-1711](./FILM-1711-analytics-authorisation.md) audits *analytics* scopes.
[FILM-1727](./FILM-1727-x-analytics.md) is X analytics. Nothing covered a
*publishing* scope, which is how a one-line gap survives three specs that each
walk past it. This spec owns it.

## 2. Why it is deferred

**We hold no X credentials** (owner, 2026-09-22). X has no sandbox and closed
Free/Basic/Pro to new signups on 2026-02-06 (see
[FILM-1725](./FILM-1725-deferred-vendor-verifications.md) Check A), so there is
no free way to exercise the consent screen or the upload.

Adding the string to the array is trivial and could be done today. It is
deliberately **not** done ahead of credentials, for two reasons:

- **Red before green cannot be met.** The only guard that matters — a real token
  carrying `media.write` completes INIT → APPEND → FINALIZE → post — cannot be
  seen to pass, and a scope change that has never been exercised is a claim, not a
  result.
- **It widens a consent screen.** Every existing X connection would have to
  re-authorise to gain the scope. Asking users to re-consent for a feature we have
  not once seen work is the wrong order.

**Deferred, not dropped.** The rule is FILM-1725's: an unanswered question does
not get to become an assumed fact by sitting in a code comment.

## 3. What brings it back

Any one of:

- An X developer app with pay-per-use credit is provisioned — for this, or for
  FILM-1725 Check A / FILM-1727, which need the same thing. **One purchase unblocks
  all three; do them together.**
- A user reports X video publishing failing. (Today the error names the scope, so
  the report will be recognisable.)
- Phase 18's [FILM-1802](../phase-18-local-vendor-sandbox/FILM-1802-social-platform-sandbox.md)
  lands. The sandbox can enforce `media.write` on `/2/media/upload` exactly as X
  documents it, which makes §4 steps 1–4 testable locally. It does **not** lift the
  deferral on its own: a sandbox proves our code against our reading of X's
  documentation, not against X. The live upload (§5, last criterion) still needs
  the credential.

## 4. The change, when it comes back

1. **Add the scope.** `X_MEDIA_UPLOAD_SCOPE` (`'media.write'`) is already exported
   from `packages/shared/src/vendors/x.ts` by FILM-1723; add it to
   `TWITTER_OAUTH_CONFIG.scopes` from that constant rather than as a second string
   literal, and correct that array's comment ("Required scopes for video upload" is
   currently untrue).
2. **Fix the class, not the instance.** The publish lambda
   (`apps/web/lambda/publish-worker/handlers/twitter.ts`) walks the upload protocol
   independently of the provider. Check whether it validates or assumes scopes, and
   keep one source of truth. Then audit the *publishing* scopes of the other four
   platforms the same way FILM-1711 audits analytics scopes — a table of endpoint →
   required scope → requested?, cited to vendor docs — so this gap is closed as a
   class. Record the scope in
   [`docs/platform-capability-reference.md`](../../docs/platform-capability-reference.md).
3. **Existing connections.** A token issued before the change lacks the scope and
   cannot gain it by refresh. Detect it — from the granted `scope` string stored at
   connection time if we keep it, otherwise from the 403 — and route the user to
   re-authorise through the existing `token-refresh.reauth` path rather than
   failing the publish with a raw vendor error. Return the refusal **as a value**,
   not a thrown message: thrown server-action errors are replaced with a generic
   sentence in production builds
   ([FILM-CC-04](../cross-cutting/FILM-CC-04-known-bugs.md) KB-6).
4. **X tokens are never refreshed.** FILM-1723 noted that `token-refresh.ts` has no
   X branch, while `offline.access` is requested and the access token lasts two
   hours. A scheduled video publish more than two hours after connecting would fail
   regardless of scope. Confirm this when the credential exists; if true it is
   **in scope here**, because `media.write` is not useful without it.
5. **UI.** The re-authorise prompt is something a user sees, so it needs a
   Playwright spec and screenshots in the PR (CLAUDE.md, "Screenshots are required
   for UI changes") — including the state *after* re-authorising.

## 5. Acceptance criteria

- [ ] `media.write` requested, from the single `X_MEDIA_UPLOAD_SCOPE` constant; the scopes comment is true
- [ ] Publishing-scope audit table for all five platforms in the capability reference, cited to vendor docs; any other gap found is fixed or filed
- [ ] A connection lacking the scope is detected and sent to re-authorise; the refusal is returned as a value and its text asserted in a production-build E2E
- [ ] X token refresh exists, or is shown not to be needed, with evidence
- [ ] Playwright spec covers: publish refused → re-authorise → second publish accepted; screenshots of each state in the PR
- [ ] **A real video is published to X end to end** with a token carrying `media.write` — FILM-1725 **Check E**. Cannot be ticked without the credential; nothing above substitutes for it

## 6. Risk

**None while deferred** beyond the status quo: X video publishing does not work,
did not work before, and the failure now says why.

When it returns, the risk is the consent change: every connected X account must
re-authorise once. Ship the detection and the prompt (§4.3) in the same release as
the scope, never the scope alone — otherwise existing connections fail exactly as
they do today, with a message telling users about a scope they cannot grant.
