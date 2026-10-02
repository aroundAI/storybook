# Vendor review status

Where each platform's approval of our **analytics** scopes stands. FILM-1711 made the
OAuth configs *request* these scopes; a request is not a grant. Until the vendor
approves, a creator we do not own cannot give us the scope however many times they
reconnect — so the product must not ask them to.

**This file and one field in code move together.** Each requirement in
`packages/features/publishing/src/oauth/analytics-scopes.ts` carries a `review`
status. While it is `required`, `pending` or `denied`, the Platform Connections page
says the scope is waiting on the vendor and shows **no** reconnect button. Flipping it
to `approved` is what starts prompting existing connections to reconnect — so flip it
only when the row below says approved, with a date.

**Update, 2026-10-02 (per owner):** Meta App Review and Meta Business Verification
are submitted. The owner said so on 2026-10-02 ("Meta App Review and Business
Verification submission — this is already done"); the repository holds no
submission date or case ID, so none is recorded here. Neither is approved, so
`review` in code stays `required` for both. Nothing else in the table below has been
submitted. Submitting needs a person with access to each vendor's developer console;
it cannot be done from the repository.

**How to do each of these by hand is in
[vendor-review-runbook.md](./vendor-review-runbook.md)**: the pre-deploy check for
PR #289, then a submission checklist per vendor with drafted justifications and
screencast shot lists. This file stays the tracker — what is submitted, and when.

**Update, 2026-09-25 (lead):** there is now a per-platform switch.
`ANALYTICS_SCOPES_ENABLED` (server-only: `youtube`, `tiktok`, `meta`) names the
platforms whose connect requests carry the new scopes; **unset is none**, the
pre-#289 request. A platform is added only after its consent-screen check passes,
so a no-go on one platform no longer holds the deploy. While a platform is off,
Settings → Platforms says its analytics are not requested yet, with no reconnect
button (`not_requested`).

**Decision, 2026-09-22 (owner), superseded in part above:** #289 merges as it is, with no per-platform switch.
Before it is deployed, the owner checks each vendor console and tries one staging
connect per platform (runbook, Part 1 — which is how FILM-1725 Check F gets run). The
submissions below are the owner's to make; the *Owner* column says "unassigned" only
because nothing has been started.

| Vendor | What is needed | Scopes it unlocks | Status | Date | Owner | `review` in code |
|---|---|---|---|---|---|---|
| Meta | **App Review** (Advanced Access) | `instagram_manage_insights`; `read_insights` and `pages_manage_engagement` for FILM-1720 (requested only while `ANALYTICS_SCOPES_ENABLED` names `facebook`) | submitted, per owner; not yet approved | 2026-10-02 (recorded; submission date not given) | owner | `required` |
| Meta | **Business Verification** | required alongside App Review — both, not either | submitted, per owner; not yet approved | 2026-10-02 (recorded; submission date not given) | owner | `required` |
| Meta | Data Use Checkup | keeps the above; annual | not due until access is granted | — | unassigned | — |
| TikTok | App review (mandatory for production on every scope) | `video.list`, `user.info.stats` | not submitted | 2026-09-22 | unassigned | `required` |
| Google | OAuth consent screen lists `yt-analytics-monetary.readonly`; re-verification if Google asks for it | `yt-analytics-monetary.readonly` | **not checked** — see below | 2026-09-22 | unassigned | `approved` |
| X | none | `tweet.read`, `users.read` (already held) | n/a | — | — | `not_required` |

Meta publishes no timeline for either review. Budget generously, and treat a rejection
as restarting the clock.

## Before this reaches production

The runbook's Part 1 turns each of these into steps. These are consequences of
requesting a scope the vendor has not approved. **None has been observed** — we hold no credentials for any of the three — so each is a question
with an owner, not a finding. They are FILM-1725 Checks F, G and H.

1. **TikTok: does the authorise page reject a request that names an unapproved
   scope?** If it does, merging the config change breaks *connecting TikTok at all*,
   publishing included, until review passes. Check in the TikTok developer portal that
   `video.list` and `user.info.stats` are added to the app before deploying, and
   connect a test account first.
2. **Meta: what does a creator without a role on the app see when the dialog asks for
   `instagram_manage_insights` before Advanced Access is granted?** The callback now
   records what `/me/permissions` says was granted, so a silently dropped permission
   is recorded truthfully — but an error page would block the connection.
3. **Google: is the monetary scope on the OAuth consent screen?** `review` is set to
   `approved` for it because a Google user *can* grant a scope the consent screen
   does not list — but may be shown an unverified-app warning. That belief is
   uncited, and says nothing about our project's console. If the
   warning appears, set `review: 'pending'` for `youtube.revenue` until verification
   passes, which also withdraws the reconnect prompt.

## What an App Review submission will need

*Uncited — general knowledge of these reviews, not a page read for this document:*
each permission is expected to be shown in use, by an account with a role on the app, which
is why the configs request the scopes before review rather than after:

- `instagram_manage_insights` — Instagram media and account insights in the analytics
  dashboard (`content-analytics/src/providers/instagram/instagram-insights.ts`).
- `video.list` — per-video views, likes, comments and shares
  (`providers/tiktok/tiktok-analytics.ts`, `/v2/video/query/`).
- `user.info.stats` — the follower series (`getFollowerCount`, `/v2/user/info/`).

On the Facebook Login path, a Page role granted through Business Manager also needs
`ads_management` + `ads_read`, or insights calls 403 silently
([capability reference](./platform-capability-reference.md#instagram)). We do not
request those; a creator in that position will show as authorised and still fail.
Recorded here so the first such report is recognised rather than debugged.
