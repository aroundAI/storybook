# Vendor review runbook

For one person doing this by hand: the owner, who is also the product's first user.
[vendor-review-status.md](./vendor-review-status.md) is the tracker — where each review
stands. This is the how: what to check before deploying PR #289 (FILM-1711), and what
each submission needs, in the order the forms ask for it.

**Decision recorded 2026-09-22 (owner):** #289 merges as it is, with no per-platform
switch. Before it is deployed, the owner checks each vendor console and tries one
staging connect per platform — Part 1 below. The submissions in Part 2 are the owner's
to make.

## How to read this document

Every requirement carries one of three marks. An unmarked requirement is a defect in
this document; treat it as unverified.

| Mark | Meaning |
|---|---|
| **[cited]** | Read on the vendor's own page on 2026-09-22; the link follows |
| **[index]** | The vendor's page was unreachable from this network (`developers.tiktok.com` refuses connections). Read through a search engine's summary of that page. The page is named so you can open it; **confirm before relying on it** |
| **[not verified]** | No source found. Check it in the console. Nothing here is a guess dressed as a fact — where it would have been, it says this instead |

Text under a **Draft** heading is a draft: written against what this product does, for
you to edit. Meta says of usage descriptions "Do not copy and paste" **[cited]**
([submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)),
so make them yours.

`<APP_URL>` is the deployed origin (`NEXT_PUBLIC_APP_URL`).

---

## Found while writing this — read first

1. **You probably do not need Meta App Review to be the first user.** Meta:
   *"If your app only serves your Instagram professional account or an account you
   manage, Standard Access is all your app needs."* Standard Access permissions *"can
   only be requested from app users who have a role on the requesting app."* **[cited]**
   ([Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview),
   [access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)).
   You have a role on the app, so you can grant `instagram_manage_insights` today and
   run Instagram analytics end to end for your own company. App Review and Business
   Verification are what you need **before onboarding anyone else**. It also gives you
   the working integration the review asks to see.
2. **Was a blocker for Meta App Review — resolved by #294.** Meta: *"Apps that access
   user data must provide a way for users to request that their data be deleted"* —
   either a callback or an instructions URL, set in the dashboard's Basic Settings
   **[cited]**
   ([data deletion callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)).
   The instructions page now exists at `<APP_URL>/data-deletion`, linked from the
   privacy policy (§1.4, §6) and the footer; that URL is what goes in Basic Settings.
   No `signed_request` callback route exists — the instructions URL is the route taken.
   Details in [Meta → Before you submit](#before-you-submit-1).
3. **Was a blocker for Google verification — resolved by #294.** YouTube's developer
   policies require the privacy policy to link YouTube's Terms of Service, link the
   Google Privacy Policy, and state that access can be revoked at Google's security
   settings page **[cited]**
   ([YouTube API Services developer policies](https://developers.google.com/youtube/terms/developer-policies)).
   `apps/web/app/(marketing)/(legal)/privacy-policy/page.tsx` now carries all three
   (§1.3 the two links, §6 the security-settings sentence), each behind a `data-test`
   that `apps/e2e/tests/legal/data-deletion.spec.ts` asserts.
4. **A failed authorise used to land on a 404 and log nothing (KB-19). It now lands on
   Settings → Platforms with the reason on the page, and writes one log line.** Not
   caused by #289, but it is what you will see if a vendor refuses a scope, so you need
   to recognise it. See
   [What a failed authorise looks like](#what-a-failed-authorise-looks-like-in-our-app).

---

# Part 1 — Pre-deploy check for PR #289

**This section is how FILM-1725 Check F gets run.** Check F asks: when the connect
route names a scope the vendor has not approved for our app, does the creator get a
working consent screen with the scope left out, or an error that blocks connecting
altogether? Nobody knows for TikTok or Meta until it is tried. Record what you see in
the results table at the end of this part, and in
`specs/phase-17-analytics-provenance/FILM-1725-deferred-vendor-verifications.yaml` §3c.

## The go / no-go rule

> **If an authorise request naming an unapproved scope is rejected outright on a
> platform, do not deploy #289 until that platform's review has passed.**

Rejected outright means you never reach a consent screen you can accept, or you are
sent back without a connection. It is a no-go because the same OAuth request carries
the publishing scopes: if connecting breaks, publishing breaks with it.

A consent screen that **works but omits** the new scope is a **go**. #289 records what
was granted rather than what was asked for, so the connection will correctly show its
analytics as not yet authorised, and publishing is untouched.

Because you hold a role on the Meta app and can be a sandbox target user on TikTok,
**your own connect succeeding does not prove a stranger's would.** For each platform
below, the check says which of the two it actually tests.

## What #289 starts requesting

| Platform | New in the authorise request | Already requested (unchanged) |
|---|---|---|
| Google / YouTube | `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | `youtube.upload`, `youtube.readonly`, `youtube.force-ssl`, `yt-analytics.readonly` |
| TikTok | `video.list`, `user.info.stats` | `user.info.basic`, `video.upload` |
| Meta | `instagram_manage_insights` | `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish`, `business_management` |

Source: `packages/features/publishing/src/oauth/{youtube,tiktok,meta}/config.ts`.

## What a failed authorise looks like in our app

Verified by running it (2026-09-22) — by sending each callback the redirect a vendor
would send, on a development server and on a production build
(`apps/e2e/tests/platform-connections/connect-failure.spec.ts`). **Not** verified
against a real vendor refusing a real scope: that is the check below, and nobody has
run it yet.

- **The vendor sends you back with an error.** You land on
  `/home/<account>/settings/platforms`, with a red box at the top of the page. **Read
  the page.** It has three parts:
  1. *What happened and what to do*, in our words. A refused scope reads
     **"<Platform> refused a permission this app asked for. The app's review for that
     permission may not be approved yet."** A cancelled or declined consent screen
     reads **"<Platform> reported that access was denied."**
  2. *What the vendor sent back*, in a grey box marked as the vendor's words: its
     `error` code, its `error_description` (cut at 300 characters) and its `log_id`
     where it sends one. This is the part to copy into the results table.
  3. A **Dismiss** button, which reloads the page without the message.
  If you belong to several workspaces and the vendor did not return our `state`, the
  same box appears on `/home` instead, because the app cannot tell which workspace the
  connect was for.
- **Which message you get is decided by the vendor's `error` code**: `invalid_scope`,
  or any code containing the word `scope`, gives the refused-permission message;
  `access_denied` gives the denied message; anything unrecognised gives "sent back an
  error this app has no written explanation for" with the vendor's text below it. What
  code TikTok or Meta actually sends for an unapproved scope is **[not verified]** — so
  if you see the generic message, the grey box is the finding, and the code in it
  should be added to `VENDOR_ERROR_CODES` in `apps/web/lib/platforms/connect-failure.ts`.
- **Every failure is logged, once.** Search the server log for the message
  **`Platform connect failed`**. The line is JSON with `name`
  (`oauth.<platform>.callback`), `platform`, `code` (ours — `invalid_scope`,
  `access_denied`, `state_expired`, `token_exchange_failed`, …), `branch` (which step
  gave up — `vendor_refused` is the vendor redirecting back with an error),
  `vendorError`, `vendorErrorDescription`, `vendorLogId`, and `accountId`. It never
  contains the authorisation code, the state or a token. Example, from a local run:

  ```json
  {"level":"error","name":"oauth.youtube.callback","platform":"youtube","code":"invalid_scope","branch":"vendor_refused","accountId":"c5be14a0-…","vendorError":"invalid_scope","vendorErrorDescription":"Scope not authorized for this client","msg":"Platform connect failed"}
  ```

  On the Lambda deployment that is CloudWatch, log group `/aws/lambda/<stage>-Web-server`
  (from `apps/web/CLAUDE.md`; the group name on the live stage is **[not verified]**).
- **The vendor refuses before redirecting.** You stay on the vendor's own error page
  (tiktok.com, facebook.com, accounts.google.com) and our app sees nothing at all after
  the `/api/platforms/connect/<platform>` redirect — **no page of ours and no log
  line.** So an absence of `Platform connect failed` is not an absence of failure:
  screenshot the vendor's page.
- **The code exchange fails after consent.** Same page, message "<Platform> showed the
  consent screen but then refused to issue an access token", and the same log line with
  `code: token_exchange_failed` and the vendor's reason in `vendorError` /
  `vendorErrorDescription`.
- **Meta only:** `oauth.meta.callback` warns `Could not read granted permissions` when
  `/me/permissions` could not be read. The connection is still saved, with an empty
  grant, and shows as "We have no record of what this connection may read".

A **successful** connect lands on
`/home/<account>/settings/platforms?success=<platform>_connected`.

After any connect, this is the ground truth — what the vendor actually granted:

```sql
select platform, platform_account_name, scopes, metadata->>'scopes_granted_at' as granted_at
from platform_connections
order by updated_at desc
limit 5;
```

## Google / YouTube

**Where to look.** Google Cloud console → the OAuth client's project → *Google Auth
Platform* (formerly "OAuth consent screen") → **Data Access**: the scopes the app has
declared, each labelled non-sensitive, sensitive or restricted; → **Verification
Center** / **Audience**: publishing status (Testing or In production) and verification
status. **[not verified]** — menu names are from memory of the console and Google moves
them; the facts to find are *which scopes are declared, how each is classified, and
whether the app is verified*.

**Is the monetary scope "sensitive"?** **[not verified]** I could not find a Google page
that classifies `yt-analytics-monetary.readonly`. The Data Access page tells you when
you add it. Write the answer into the results table — Part 2's Google section depends
on it.

**What you should see.**

- *Documented:* Google lets a user grant only some of what is asked — *"users may not
  grant your app access to all of them. Your app must verify which scopes were actually
  granted"* **[cited]**
  ([OAuth for web server apps](https://developers.google.com/identity/protocols/oauth2/web-server)).
  The new line on the consent screen should read **"View monetary and non-monetary
  YouTube Analytics reports for your YouTube content"** **[cited]**
  ([scope table](https://developers.google.com/youtube/reporting/guides/authorization)).
  If you untick it, the connect still succeeds and the connection shows revenue as
  missing, with a reconnect button. That is correct behaviour.
- *Documented:* an unverified app asking for a sensitive or restricted scope shows the
  **unverified app screen** before consent, and is capped at *"100 new users in total"*
  **[cited]** ([unverified apps](https://support.google.com/cloud/answer/7454865)). It is
  a warning you can click through ("Advanced"), not a rejection.
- *Unknown until tried:* what happens when the request names a scope that is **not
  declared on the Data Access page at all**. Add it there first and the question does
  not arise.

**Go / no-go.** Google is a **go** unless the authorise request itself errors. The
unverified-app screen is a go for you as first user; it is the thing to clear (Part 2)
before onboarding others. Your own connect **does** predict a stranger's here, apart
from the warning screen and the user cap.

## TikTok

**Where to look.** [developers.tiktok.com](https://developers.tiktok.com) → *Manage
apps* → the app → **Scopes** (under the products you added — Login Kit, Content Posting
API): which scopes are added, and for each whether it is approved for production or
only present in a sandbox. **[not verified]** — the portal was unreachable while this
was written.

**What you should see.**

- **[index]** After approval, *"users will be asked to authorize and confirm your
  access"*, and a user may grant only a subset of what is requested
  ([Scopes overview](https://developers.tiktok.com/doc/scopes-overview),
  [Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web)). So an approved
  scope appears as a line on TikTok's authorise page.
- **Unknown until tried — and the one most likely to be a no-go.** What TikTok does
  with an authorise request naming a scope the app is **not** approved for. The search
  summary of TikTok's Login Kit pages described this as a common cause of
  "scope not authorized" errors, which points at *rejected outright*; that phrase is the
  summariser's, not a quotation, so it is a reason to test first, not a finding.
  TikTok's OAuth errors carry a readable error code, a message and a `log_id`
  **[index]** ([OAuth error handling](https://developers.tiktok.com/doc/oauth-error-handling))
  — copy all three from the grey "What TikTok sent back" box on Settings → Platforms if
  it happens (the same three are in the `Platform connect failed` log line). Whether
  TikTok sends `log_id` as a parameter of the redirect, which is the only place our
  callback can read it from, is **[not verified]**; if the box shows no Log ID, take it
  from TikTok's own error page.

**How to test without breaking production.** Create a **sandbox** on the app, add
`video.list` and `user.info.stats` to it, add your own TikTok account as a target user,
and point staging at the sandbox's credentials. Sandbox needs no review, allows up to
5 sandboxes and up to 10 target accounts, and target-user changes can take up to an
hour to apply **[index]** ([Add a sandbox](https://developers.tiktok.com/doc/add-a-sandbox)).
Whether a sandbox has its own client key and secret: **[not verified]** — look on the
sandbox's page.

That sandbox connect tests *"does our code work once the scope is granted"* (it also
runs FILM-1725 Checks B and H for TikTok). It does **not** test the production app. To
test that, try a staging connect with the **production** credentials before the scopes
are approved, and see whether you reach a consent screen.

**Go / no-go.** If the production-credential attempt is refused, **TikTok is a no-go
until app review passes.** If you would rather not find out, the safe order is: submit
the review (Part 2), wait for approval, then deploy.

Note for later, not for this check: unaudited TikTok apps have posted content forced to
private (`docs/platform-capability-reference.md` → TikTok), so the sandbox is for
proving the integration, not for real publishing.

## Meta (Instagram)

**Where to look.** [developers.facebook.com/apps](https://developers.facebook.com/apps)
→ the app → **App Review → Permissions and Features**: each permission shows its access
level, Standard or Advanced. → **Settings → Basic**: app mode (Development / Live),
Privacy Policy URL, and the Data Deletion field. Business Verification status is in
Business settings → Security Centre. **[not verified]** for exact menu names.

**What you should see.**

- *Documented:* with a role on the app, you can grant a Standard Access permission. So
  **your** staging connect should show `instagram_manage_insights` in the Facebook Login
  dialog, succeed, and record it **[cited]**
  ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)).
- *Documented as undocumented:* Meta's access-levels page **does not say** what a user
  *without* a role sees when the dialog asks for a Standard-Access-only permission —
  omitted line, or error. **[not verified]** To test it, connect from a Facebook account
  with no role on the app, with the app in Live mode.
- After connecting, `scopes` on both the Facebook Page row and the Instagram row should
  list every permission Meta reports as `granted` from `GET /me/permissions`
  **[cited]** ([user permissions](https://developers.facebook.com/docs/graph-api/reference/user/permissions/)).

**Go / no-go.** For you as the only user: **go** if your own connect works. The
non-role test decides whether Meta stays a go **once other people can sign up**; if a
non-role connect is rejected outright, do not open sign-ups until Advanced Access is
granted. That is later than this deploy, which is why it is recorded rather than
blocking.

**Your existing Instagram connection will not show a reconnect button** — the code has
`review: 'required'` for it, which is right for a stranger and wrong for you. Use the
card's **Connect / Connect Another** button instead: it runs the same OAuth flow and
updates the same row.

## Record the result (this is Check F)

Fill this in, and copy the outcome into FILM-1725 §3c.

| Platform | Date | Credentials used | Reached a consent screen? | New scope offered? | Granted (`scopes` column) | Go / no-go |
|---|---|---|---|---|---|---|
| Google | | production | | | | |
| TikTok | | sandbox | | | | |
| TikTok | | production, before approval | | | | |
| Meta | | role account | | | | |
| Meta | | non-role account, app Live | | | | |

While you hold the tokens, the same session answers FILM-1725 **Check G** (YouTube
revenue with and without the scope) and **Check H** (TikTok and Instagram analytics
return data); the commands are in that spec.

---

# Part 2 — Submission checklists

**Walk each shot list once before recording.** The tab and card names below were
checked against the code on 2026-09-22, but the platform filter does not reach every
tab yet (FILM-1709) and the analytics tabs are mid-rework in this phase. A screencast
that shows an empty card for the permission under review is a rejection.

Order of work that wastes least time: fix the three repo blockers at the top of this
document → Part 1 → TikTok submission (longest unknown, and gates the most) → Google →
Meta (you can already use Instagram analytics yourself).

## TikTok app review — `video.list` and `user.info.stats`

**Why this one first.** These two Display API scopes serve **every** TikTok channel,
personal or business. The deeper Business API (FILM-1730) serves only creators on a
Business account — on the planning assumption of a 50-50 split between business
marketing channels and content channels, about half. `video.list` is the floor under
all of them.

Everything in this section is **[index]** unless marked otherwise: read through a
search summary of the named page. **Open each page in a browser and confirm before
submitting.**

### Before you submit

- [ ] App icon, name and description meet TikTok's
      [basic information specifications](https://developers.tiktok.com/doc/basic-information-specifications).
      The description is shown to users on the authorise page.
- [ ] **Terms of Service URL** and **Privacy Policy URL**
      ([Register your app](https://developers.tiktok.com/doc/getting-started-create-an-app)).
      Ours: `<APP_URL>/terms-of-service` and `<APP_URL>/privacy-policy` — both routes
      exist under `app/(marketing)/(legal)/`.
- [ ] Platform **Web**, with the URL of the official website.
- [ ] **Redirect URI**: `<APP_URL>/api/platforms/callback/tiktok` — exactly what
      `connect/tiktok/route.ts` sends. Must be `https`, absolute and static with no query
      string or fragment; at most 10 are allowed
      ([Login Kit for Web](https://developers.tiktok.com/doc/login-kit-web)). Register
      staging's as well.
- [ ] Products added: **Login Kit** and **Content Posting API** (already in use for
      publishing). `video.list` and `user.info.stats` added under Scopes.
- [ ] Whether the website's domain must be verified: **[not verified]** — check in the
      console.
- [ ] A **sandbox** with both scopes and your test account as a target user. *"If your
      app has not been approved before, you are required to use a sandbox environment
      … to demonstrate the integration"*
      ([App review guidelines](https://developers.tiktok.com/doc/app-review-guidelines)).
      Whether our app counts as approved before (it holds `video.upload`):
      **[not verified]**.
- [ ] A test TikTok account with at least one public video, so the recording shows real
      numbers.
- [ ] Staging deployed with #289 and running against the sandbox.

### Draft — scope explanations

Whether the form has one text box per scope or one for all: **[not verified]**.

> **`video.list`** *(draft)* — StoryBook is a studio for producing and publishing video
> series. After a creator publishes a video to TikTok from StoryBook, we call
> `/v2/video/query/` with that video's ID to read its view, like, comment and share
> counts, and show them to the same creator on their analytics dashboard beside the
> same episode's results on their other platforms. We read only videos on the
> creator's own account and only the ones published through StoryBook. The figures are
> shown to the creator who connected the account and to members of their workspace; we
> do not sell, share or aggregate them across creators.

> **`user.info.stats`** *(draft)* — We read `follower_count` from `/v2/user/info/` once
> a day to draw the creator's follower growth over time on their analytics dashboard,
> so they can see how each published series moved their audience. We request no other
> field under this scope. The figure is shown only to the creator and their workspace.

### Draft — demo video shot list

Constraints: at least one video showing *"the complete end-to-end flow"*, at most 5
videos of up to 50 MB each; every selected product and scope must be clearly
demonstrated, with the interface and the user's interactions visible; for a web app the
domain in the video must match the website URL you registered
([App review guidelines](https://developers.tiktok.com/doc/app-review-guidelines)).
Record on the staging domain you registered, not `localhost`.

1. Browser address bar visible on `<APP_URL>`. Sign in to StoryBook.
2. **Settings → Platforms** (`/home/<account>/settings/platforms`). The TikTok card,
   not yet connected.
3. Click **Connect** on the TikTok card. Show TikTok's authorise page with each
   requested permission legible — pause on it. Approve.
4. Back on Platform Connections: the TikTok account shown as **Connected**, with **no**
   "analytics are not authorised" notice. *(Shows both scopes granted.)*
5. *(Content Posting API, already approved — keep it short, but "end to end" means it
   is there.)* Publish a short video to TikTok from the Publish Hub.
6. The project's analytics dashboard
   (`/home/<account>/studio/<project>/analytics`), **Content** tab, platform filter on
   TikTok: that video's views, likes, comments and shares. Say, or caption: *"These
   come from `video.list`."*
7. The **Deep Dive** tab's subscribers card (`subscriber-series-card.tsx`) with the
   TikTok series. Caption: *"This is `follower_count`, from `user.info.stats`."* It
   fills one point per day, so connect the test account a few days before recording.
8. Back to **Settings → Platforms → Disconnect**, to show the creator can withdraw.

### Timing, and after approval

- Review *"may take several days to two weeks"*, and TikTok gives no official timeline
  or guarantee ([App review FAQ](https://developers.tiktok.com/doc/getting-started-faq)).
- **After approval:** in one commit, set `review: 'approved'` on `tiktok.video-metrics`
  and `tiktok.follower-count` in
  `packages/features/publishing/src/oauth/analytics-scopes.ts`, and update the TikTok
  row of [vendor-review-status.md](./vendor-review-status.md) — status, date, and
  `` `approved` `` in the last column. `pnpm --filter @kit/publishing test` fails if the
  two disagree. **That flip is what starts showing existing TikTok connections a
  reconnect button**, so do it only once approval is real.

## Meta — App Review for `instagram_manage_insights`, and Business Verification

### What changed since the review you did on the old API

- **There are now two Instagram APIs with two permission vocabularies.** *Instagram API
  with Facebook Login* (host `graph.facebook.com`, for professional accounts linked to
  a Facebook Page) uses `instagram_basic`, `instagram_content_publish`,
  `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`. *Instagram
  API with Instagram Login* (host `graph.instagram.com`) uses the
  `instagram_business_*` names **[cited]**
  ([Instagram Platform overview](https://developers.facebook.com/docs/instagram-platform/overview)).
  **We are on Facebook Login.** Do not request the `instagram_business_*` permissions,
  and do not add the "Instagram Login" product to the app by mistake — it is a
  different review.
- **Access levels replaced "approved / not approved".** Every permission starts at
  Standard Access, grantable only by people with a role on the app. Advanced Access is
  what review grants **[cited]**
  ([access levels](https://developers.facebook.com/docs/graph-api/overview/access-levels)).
- **Business Verification is now required for Advanced Access** — *"Advanced Access now
  requires Business Verification"*, from 2023-02-01 **[cited]** (same page). Both, not
  either.
- **Deprecated metrics.** `plays`, `impressions`, `clips_replays_count` and
  `ig_reels_aggregated_all_plays_count` were removed across all versions on 2025-04-21;
  use `views` (`docs/platform-capability-reference.md` → Instagram, cited there). Our
  provider already does. Do not show or mention the old names in the screencast.
- **Graph version.** We pin v23.0 (#284). Nothing in this checklist is version-specific;
  anything that turns out to be belongs with the v26.0 bump, FILM-1728.
- The Instagram **Basic Display API**'s shutdown: **[not verified]** — I could not find
  it on the pages I could reach. We never used it, so nothing depends on it.
- The per-permission reference (`developers.facebook.com/docs/permissions`) returned
  HTTP 500 on every attempt, so the exact "allowed usage" wording and any dependency
  list for `instagram_manage_insights` are **[not verified]**. The form shows them when
  you select the permission — read them there and check the draft below against them.

### <a id="before-you-submit-1"></a>Before you submit

In the order the submission guide walks through them **[cited]**
([submission guide](https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review/submission-guide)):

- [ ] **Make at least one successful API call with each permission, within 30 days
      before submitting.** *"Make at least 1 successful API call using each permission
      for which you are requesting advanced access. Calls must be made within 30 days of
      submitting for App Review."* In practice: connect your own Instagram account on
      staging (Part 1) and let one analytics sync run. If a month passes, run it again.
- [ ] **Business Verification.** *"you may be prompted to complete business verification
      if you have not done so already."* Needs a business portfolio (Business Manager)
      that has claimed the app. The documents Meta accepts, by country:
      **[not verified]** — the verification flow in the Security Centre lists them.
      The legal entity named in our privacy policy is **Around AI Limited**; the
      documents have to match whatever name you enter.
- [ ] **Data handling questions** — answered in the form.
- [ ] **App settings:** app icon that *"does not include any of our trademarks or
      logos"* (no Instagram glyph in it); **Privacy Policy URL**
      (`<APP_URL>/privacy-policy` — exists); app purpose; a category that *"accurately
      describes your app"*; verified primary contact email.
- [ ] **Data deletion — instructions URL built (#294); paste it.** Meta accepts either a
      **Data Deletion Request URL** — an HTTPS endpoint receiving *"a POST with a signed
      request"* containing the app-scoped user ID, which must *"Return a JSON response
      that contains a URL where the user can check the status of their deletion request
      and an alphanumeric confirmation code"* — or a **data deletion instructions URL**,
      entered in Basic Settings **[cited]**
      ([data deletion callback](https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback)).
      We took the second: `<APP_URL>/data-deletion` says how to disconnect (Meta:
      `DELETE /me/permissions` in `packages/features/publishing/src/oauth/meta/disconnect.ts`,
      then the stored tokens go), how to delete the account, what each removes, and how
      to ask for the rest by email — see `docs/data-deletion-runbook.md` for the
      operator's side of that promise. The callback would be a new route, e.g.
      `apps/web/app/api/platforms/meta/data-deletion/route.ts`, verifying
      `signed_request` with the app secret; not built. Whether Meta accepts an
      instructions URL alone for this review: the page offers both, so **[cited]** as an
      option, but which one a reviewer prefers is **[not verified]**.
- [ ] **App verification:** *"describe how we can access your app in order to test
      it."* *"Your app must be publicly available or you must provide instructions on
      how to access it."* And: *"We will test your app using our own test accounts. Do
      not include your personal … credentials."* So: create a StoryBook reviewer login
      on staging (email + password, with a team account and a project already set up)
      and give **that**. The reviewer connects their own Facebook and Instagram test
      accounts. Whether they need to be added to the app's roles to do it while the
      permission is at Standard Access: **[not verified]** — ask in the submission notes
      if the form does not say.

### Draft — usage descriptions

One per permission, each *"unique"*, covering how it helps the user and how the app
uses the data **[cited]** (submission guide). You are requesting Advanced Access for
`instagram_manage_insights`; if `instagram_basic` and `pages_read_engagement` are also
still at Standard Access in the dashboard, they need it too, and have drafts below.

> **`instagram_manage_insights`** *(draft)* — StoryBook lets a creator produce a video
> series and publish each episode as a Reel to their own Instagram professional
> account. With this permission we read the insights for the Reels they published
> through StoryBook — views, likes, comments, saves and shares — and the
> account's audience breakdown by country, city, age and gender, and show them to that
> creator on their StoryBook analytics dashboard beside the same episode's results on
> their other platforms. It lets them see which episodes worked without moving between
> apps. We read insights only for the account the creator connected; we show them only
> to that creator and the members of their workspace; we do not share or sell them.

> **`instagram_basic`** *(draft)* — We read the connected Instagram professional
> account's username, profile picture and follower count so the creator can see which
> account they have connected on the Platform Connections page, and we read a
> published Reel's media type so we request the insights that exist for it.

> **`pages_read_engagement`** *(draft)* — An Instagram professional account is reached
> through the Facebook Page it is linked to. We use this permission to read the Pages
> the creator manages, find the Instagram account linked to the Page they choose, and
> read its insights with that Page's token.

### Draft — screencast shot list

Constraints **[cited]** (submission guide): *"1080 or better"*; show *"an app user
granting your app each permission"* and *"how your app uses each granted permission"*;
English UI where possible; captions if it helps; use the mouse rather than the
keyboard; *"Record only what we need to see."* One recording per permission is what the
form asks for; the first three shots can open each of them.

1. `<APP_URL>`, signed in as the reviewer login. **Settings → Platforms**. The
   Instagram card with nothing connected.
2. Click **Connect** on the Instagram card. The Facebook Login dialog: pause where it
   lists the permissions, so `instagram_manage_insights` — "access insights for the
   Instagram account" or however the dialog words it — is on screen. Choose the Page
   and the Instagram account. Continue.
3. Back on Platform Connections: the Instagram account as **Connected**, with no
   "analytics are not authorised" notice. Caption: *"StoryBook recorded the permissions
   Meta granted."*
4. *(`instagram_basic`)* Point at the username, avatar and follower count on that row.
5. *(`instagram_manage_insights`)* The project's analytics dashboard
   (`/home/<account>/studio/<project>/analytics`), **Content** tab, platform filter on
   Instagram: a Reel published from StoryBook with its views, saves and shares. Then
   the **Audience** tab's country and age breakdown. Caption each with the permission
   name. (`reach` is fetched but has no column until FILM-1712, so do not promise it on
   screen; and FILM-1701 is reworking the Audience tab — record after it lands, or
   check what the tab shows first.) This needs a Reel that is at least a day or two old — insights
   *"may be delayed up to 48 hours"* (capability reference → Instagram).
6. *(`pages_read_engagement`)* Covered by shot 2's Page picker; say so in a caption.
7. **Settings → Platforms → Disconnect.** Caption: *"Disconnecting revokes StoryBook's
   permissions at Meta and deletes the stored tokens."* If the data-deletion page
   exists by then, open it.

### Timing, and after approval

- The submission guide says *"you should receive a decision within a week"* **[cited]**.
  Business Verification has no stated duration on the pages I read — **[not verified]**;
  start it first, since the review can prompt for it and stall.
- A rejection comes back with notes per permission; fix and resubmit. Treat each one as
  restarting the clock.
- **After Advanced Access is granted (and Business Verification passed):** set
  `review: 'approved'` on `instagram.insights` in `analytics-scopes.ts` and update both
  Meta rows of the tracker in the same commit; the binding test enforces it. That is
  what starts prompting existing Instagram connections to reconnect.
- Meta's annual **Data Use Checkup** then keeps the access. Put it in a calendar.
- `read_insights` (Facebook video analytics) is a **separate, later** submission, made
  when FILM-1720's provider exists to show it in use.

## Google — OAuth verification for `yt-analytics-monetary.readonly`

### What it triggers

- Apps requesting **sensitive or restricted** scopes must, beyond brand verification,
  *"provide a detailed justification for your requested scope(s)"* and a **demo video**
  showing *"the end-to-end flow of your app including the OAuth grant process"* and
  *"the app functionalities that utilize the requested OAuth scopes"* **[cited]**
  ([OAuth app verification](https://support.google.com/cloud/answer/13464321)).
- A **security assessment** is required for **restricted** scopes only — *"Apps
  requesting access to restricted scopes must meet the additional requirement of secure
  data handling by submitting to an annual security assessment"* **[cited]** (same
  page). Whether this scope is sensitive, restricted or neither is **[not verified]**
  (see Part 1). If the console says *restricted*, stop and re-plan: that is a paid
  third-party assessment, a different order of cost.
- Adding a scope to an already-verified app: *"If you change your client or use new
  scopes after verification, you might have to go through verification again"*
  **[cited]** ([unverified apps](https://support.google.com/cloud/answer/7454865)). Our
  app already holds `youtube.upload` and `yt-analytics.readonly`; whether it is
  currently verified for them is **[not verified]** — the Verification Center says.
- **In the meantime**, users see the unverified app screen before consent, and the app
  is limited to *"100 new users in total"* **[cited]** (same page). Apps *"still in
  development"* (publishing status Testing, with you as a listed test user) do not need
  verification **[cited]**. That covers you as first user. Test-user and token-lifetime
  limits in Testing status: **[not verified]**.
- How long verification takes: the page does not say — **[not verified]**.

### Before you submit

- [ ] Homepage on *"a verified domain you own"*, with the privacy policy *"linked on
      your homepage"* and the same link on the OAuth consent screen **[cited]**
      (OAuth app verification). Confirm the marketing homepage footer links
      `/privacy-policy`.
- [ ] *"verify that you own all domains listed in your Authorized domains section"*
      **[cited]** — done through Search Console; **[not verified]** for the exact steps.
- [x] **Privacy policy — the three items are in (#294).** YouTube's developer
      policies require an API client's privacy policy to *"display a link to YouTube's
      Terms of Service (https://www.youtube.com/t/terms)"*, to *"reference and link to
      the Google Privacy Policy at http://www.google.com/policies/privacy"*, and to
      *"explain that, in addition to the API Client's normal procedure for deleting
      stored data, users can revoke that API Client's access to their data via the
      Google security settings page at
      https://security.google.com/settings/security/permissions"* **[cited]**
      ([developer policies](https://developers.google.com/youtube/terms/developer-policies)).
      Ours has all three: the two links in §1.3 beside the "Social Platforms" entry,
      the security-settings sentence in §6, each with a `data-test` that
      `apps/e2e/tests/legal/data-deletion.spec.ts` asserts against the exact URL the
      policy names.
- [ ] **Retention, as the policies actually read (III.D, III.E.4, checked
      2026-09-22):** a user's YouTube data must be deleted within **7 calendar days** of
      a disconnect made through our app (our Disconnect button is the "mechanism" III.D
      names) and of any deletion request; within **30 calendar days** when access is
      revoked at Google or the token can no longer be refreshed; analytics kept while
      the authorisation is valid has **no cap**, but the client must confirm every 30
      days that it is still authorised **[cited]**. What we do: the hourly sync uses the
      token, so a revoked or lapsed authorisation surfaces as a failed sync; the
      deletion itself is done by hand, within those windows, from
      `docs/data-deletion-runbook.md` — nothing automates it yet (KB-20 item 3, required
      before a second account). `/privacy-policy` §1.4 and `/data-deletion` state these
      windows, so a verifier reads the same figures the policy sets.
- [ ] The scope added on the console's Data Access page, with its justification.
- [ ] A demo Google account owning a YouTube channel. To show revenue figures, not just
      the consent line, the channel has to be in the Partner Program — revenue metrics
      are Partner-Program-only (`docs/platform-capability-reference.md` → YouTube). If
      you have none, show the honest state instead: see shot 5.

### Draft — scope justification

> *(draft)* StoryBook helps creators produce, publish and analyse video series on their
> own YouTube channels. `yt-analytics-monetary.readonly` is used for one purpose: to
> read `estimatedRevenue`, `estimatedAdRevenue` and `estimatedRedPartnerRevenue` for
> the videos the creator published through StoryBook, and show that creator their
> revenue per episode and the split between ads and YouTube Premium on their analytics
> dashboard. `yt-analytics.readonly`, which we already hold, does not return revenue
> metrics; Google's reference says the monetary scope is the one that provides
> "estimated revenue and ad performance metrics", so no narrower scope serves. We make
> this request separately from all other analytics calls and only for connections that
> granted the scope. The data is shown only to the channel's owner and their workspace,
> is not shared with third parties, and is not used for advertising.

### Draft — demo video shot list

Must show the whole flow including the OAuth grant, and the features that use the
scope **[cited]**. Whether Google requires the OAuth client ID to be visible in the
address bar during the grant, and where the video must be hosted: **[not verified]** —
the verification form states both.

1. `<APP_URL>` homepage; scroll to the footer's privacy policy link and open it.
2. Sign in. **Settings → Platforms.** An existing YouTube connection showing *"Some
   analytics are not authorised on this connection — Estimated revenue, split into ads
   and YouTube Premium"* and the **Reconnect YouTube to grant access** button.
3. Click it. Google's consent screen, address bar visible: pause on the line **"View
   monetary and non-monetary YouTube Analytics reports for your YouTube content"**.
   Grant.
4. Back on Platform Connections: the notice is gone.
5. **Studio → Analytics** (`/home/<account>/studio/analytics`), the **Revenue**
   section: Total Revenue, the **By Content** tab, and **Revenue Mix** (ads against
   Premium) for a Partner Program channel. If the demo channel is not in the programme, show instead
   the notice that replaces it — *"YouTube only reports revenue for Partner Program
   channels"* — and say in the justification that this is what a non-partner creator
   sees.
6. Disconnect, to show access can be withdrawn; mention the Google security settings
   page.

### After approval

Nothing to flip: `review` is already `approved` for `youtube.revenue`, on the
reasoning that a Google user can grant the scope before verification and sees a warning
rather than a refusal. **If Part 1 shows otherwise** — the authorise request errors, or
the warning screen is bad enough that you would not send a customer through it — set
`review: 'pending'` for `youtube.revenue` and change the Google row of the tracker in
the same commit. That withdraws the reconnect prompt until verification passes; flip it
back afterwards.
