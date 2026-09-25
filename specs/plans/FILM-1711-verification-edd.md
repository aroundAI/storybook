# EDD — FILM-1711 Analytics Authorisation: what is met on main, what is deployed, and what closes it

- **Teammate:** assets-delete · **Written:** 2026-09-25, against `origin/main` 2dd2fb26
- **Spec:** `specs/phase-17-analytics-provenance/FILM-1711-analytics-authorisation.yaml` (🟡 PARTIAL, effort L). Shipped in **#289** (`f2fc4ec1`, merged 2026-09-22 17:49 +0530).
- **Scope of this EDD:** verify every acceptance criterion against main, separate **merged** from **deployed**, and plan what closes the spec. FILM-1711's code is built. What remains is records, owner actions at the vendors, and a deploy. This EDD proposes no product code.


## Decisions after review (2026-09-25, lead)

- Q1: production is on `d8c635c1`-era code, recorded as inferred from its migrations; the owner deploys after this wave.
- Q2: criterion #10 moves to FILM-1705.
- Q3: the five dependents' notes point at "#289's code".
- Q4 (the monetary scope on Google's consent screen) is with the owner.

---

## 0. Summary

1. **On main, the spec's code does what it claims.**
   - 14 of the 18 criteria marked met still hold.
   - FILM-1711's four test files pass: 58 + 24 + 94 tests across content-analytics, publishing and clickhouse.
   - All **19 of its 19 unit mutation guards still go RED** with their fix removed (§3).
   - The one E2E guard (E1) and `analytics-access.spec.ts` were not re-run: they need the shared DB and a server.
2. **None of it is deployed** (inferred, as FILM-1723's EDD found).
   - Production's migrations stop at `20260831113625`, from `d8c635c1` (#232, 2026-08-31).
   - #289 merged three weeks later.
   - #289 has **no migration**, so production gives no direct signal for it. The inference rests on production's migration level, and the owner can confirm it in one look at the deployed commit (Q1).
   - In production today, every FILM-1711 behaviour is absent:
     - no analytics scopes requested;
     - callbacks record the scopes requested, not the ones granted;
     - `fetchTotals` asks for revenue on a token without the monetary scope;
     - the cron throws `*ScopeError`s;
     - no reconnect prompt.
3. **Four things keep it PARTIAL, and none is engineering work in this repo:**
   - (a) Meta App Review, Business Verification and TikTok app review: not submitted (owner).
   - (b) FILM-1725 Check F, the consent screens: must run **before** the deploy that carries #289.
   - (c) Checks G and H (live YouTube revenue, live TikTok/Instagram data): after that deploy.
   - (d) One criterion, `not_authorised` vs `no_data_in_window`, cannot close in FILM-1711. Its second state belongs to FILM-1704/1705, both DRAFT. I propose re-homing it (Q2).
4. **Found while verifying (§4):**
   - The runbook's four pre-submission blockers: three are **fixed on main**. The data-deletion page and the three YouTube privacy items came in #294 (`162a0f1c`); the 404 on a failed connect in #297 (KB-19). The spec's notes still list them as open.
   - **FILM-1726's open concern is already fixed by #289.** Its "The zero is being written as authoritative" says zero-valued `api` revenue rows are written without the scope. On main, unmeasured revenue is never written (`revenue_measured`), and a zero with no existing row is never inserted (`planRevenueRowWrites`).
   - **LinkedIn's callback still records the scopes it requested as the grant.** That's the exact shape #289 fixed for the five analytics platforms. LinkedIn has no analytics provider, so nothing reads it today (a lead, not a KB).
   - **The lead's list of dependents includes FILM-1715, but 1715 does not depend on FILM-1711.** Neither its YAML nor INDEX lists it, and in the README's graph FILM-1715 is a child of FILM-1721.
5. **What "blocks" means for the dependents** (1712, 1720, 1726, 1727, 1730).
   - They need FILM-1711's **code**: the scope declarations, the binding test, the access states. That's merged.
   - None needs the vendor reviews to be **built**. Only their live verification needs them, and that is FILM-1725's job.
   - Proposed, as FILM-1723's EDD did: their dependency notes say "#289's code", so a vendor console queue doesn't hold five DRAFT specs (Q3).

---

## 1. The user

**Who:** a creator with YouTube, TikTok or Instagram connected, and the owner, who is the first such creator and the only person who can act at the vendors.

**What they get when FILM-1711 is DONE, in production:**
- Analytics requests only what the connection is allowed to read.
- A connection missing a scope is shown as such, saying who can fix it:
  - reconnect (`scope_missing`);
  - the vendor, no button (`review_pending`);
  - the creator's account type (`account_type_gated`);
  - no record (`unknown`).
- YouTube revenue arrives for Partner Program channels.
- TikTok and Instagram per-video analytics arrive once the vendors approve.
- The cron stops retrying connections it knows it can't read.

**What they get today, in production:** none of it (§2). **On main:** all of it except what needs a vendor or a live account.

---

## 2. Merged vs deployed

### 2.1 Which code production runs

- **Evidence** (the owner's read-only production queries, 2026-09-25, recorded in FILM-1723's EDD §4.1): 131 migrations applied, the latest `20260831113625` (`d8c635c1`, #232, 2026-08-31).
- The deploy runs migrations, so production's app code is at or near `d8c635c1`.
- **Inference, not observation.** The app could have been deployed without its migrations. One look at the deployed commit on the SST dashboard settles it (Q1, shared with FILM-1723).
- **FILM-1711 has no migration.** `git show --stat f2fc4ec1`: 40 files, none under `supabase/migrations/`. So production can't show whether #289 is deployed; only the deployed commit can.

### 2.2 What production does instead

These are the pre-#289 behaviours, read at `d8c635c1`'s parent state as the spec's own notes describe them.

| Behaviour | Production (inferred, `d8c635c1`) | Main (`2dd2fb26`) |
|---|---|---|
| Scopes requested | YouTube without the monetary scope; TikTok `user.info.basic`, `video.upload`; Meta without `instagram_manage_insights` | + `yt-analytics-monetary.readonly`, `video.list`, `user.info.stats`, `instagram_manage_insights` |
| `platform_connections.scopes` | the scopes **requested** (YouTube, Meta, Instagram); TikTok/X fall back to requested | the scopes **granted** (Google/TikTok/X `scope`, Meta `/me/permissions`); `[]` when unknown |
| YouTube revenue | inside `fetchTotals`, on a token without the scope | a separate `fetchRevenue`, only with the scope; a 403 degrades revenue only |
| Unauthorised TikTok/Instagram | a `*ScopeError` per publish per run, into publish metadata | not called (`syncEligibility`), no batch slot |
| `requires_reauth` after reconnect | stays skipped forever | cleared by a newer grant |
| Platform Connections | nothing about analytics access | per-requirement state and a reconnect prompt naming the gain |
| Meta Graph version | v18/v19 literals, which Meta now serves as v21 (FILM-1723 §4) | FILM-1723's pinned constant |

### 2.3 What the deploy that carries #289 changes for existing connections

- **Nothing changes until the owner opens Settings → Platforms**, and publishing is untouched: old tokens keep their scopes.
- **YouTube** connections show "reconnect to add estimated revenue", because `review: 'approved'` for Google.
- **TikTok and Instagram** show "waiting on the vendor" with no button (`review: 'required'`), until each review passes and the code's field is flipped along with `docs/vendor-review-status.md` (a test binds the two).
- **The risk** is the one the spec names: if TikTok's authorise page rejects a request naming an unapproved scope, **connecting TikTok at all breaks**, publishing included. That's why FILM-1725 Check F runs **before** this deploy, not after.

---

## 3. Every criterion, verified against main

Test runs on `2dd2fb26`:
- content-analytics `analytics-scope-binding`, `sync-authorisation`, `sync-unauthorised-connections`, `youtube-analytics`: **58 passed**.
- publishing `analytics-scopes`: **24 passed**.
- clickhouse `data-provenance`: **94 passed**.
- `tooling/mutation-guards/film-1711.json`, each unit entry run through the runner's own `run_entry`: **19 of 19 RED**, and E1 (e2e) not run.

| # | Criterion | Spec says | On main | Evidence re-checked | Deployed? |
|---|---|---|---|---|---|
| 1 | Scope requirements declared in code beside the configs | met | **met** | `packages/features/publishing/src/oauth/analytics-scopes.ts`: requirements for youtube ×3, tiktok ×2, instagram ×2, facebook ×1, twitter ×1, each with `gains` and `review` | no |
| 2 | A test fails if a provider calls an endpoint whose scope isn't requested | met | **met** | `analytics-scope-binding.test.ts` green; guards A1–A7 RED | no |
| 3 | TikTok requests `video.list`; nothing references a `video.query` scope | met | **met** | `oauth/tiktok/config.ts:16`. `git grep video.query`: 9 hits, every one a negation or the test asserting absence | no |
| 4 | Instagram requests the right permission set for the login path | met | **met** | `oauth/meta/config.ts`: `instagram_basic`, `instagram_manage_insights`, `pages_read_engagement` (Facebook Login) | no |
| 5 | Meta App Review and Business Verification submitted, and tracked | not met | **not met, tracked** | `docs/vendor-review-status.md`: every row "not submitted", owner "unassigned"; guard D6 RED | — (owner) |
| 6 | `platform_connections.scopes` written at callback | met | **met** (five analytics platforms) | youtube `:255` and save-channel `:106`, tiktok `:202`, twitter `:212` via `parseGrantedScopes`; meta `:249,:291` from `/me/permissions`. **LinkedIn `:181` still writes the requested list** (§4.3) | no |
| 7 | `account_type_gated` distinct from `scope_missing` | met | **met** | `analytics-scopes.ts:281-283`, `:357`, `:364`; guard D2 RED | no |
| 8 | Graph v18.0 liveness checked before blaming scopes | met | **met as a 2026-09-21 probe; superseded** | FILM-1723 (#284) pinned the version on main. Production still calls v18/v19, served as v21 (FILM-1723 EDD §4). The masking cause this criterion guards against is still live **in production** until the same deploy | no |
| 9 | A missing scope is detectable without a failed sync | met | **met** | `resolveAnalyticsAccess` (`analytics-scopes.ts:324`), read by `connection-actions.ts:91` (the page) and, through `videoSyncAuthorisation` (`:402`), by `sync-authorisation.ts` (the cron) | no |
| 10 | `not_authorised` distinct from `no_data_in_window` everywhere both appear | not met | **not met, and not closable here** | `git grep no_data_in_window` finds nothing: the state arrives with FILM-1704 (DRAFT) and first shares a surface with `not_authorised` in FILM-1705 (DRAFT). **Q2: re-home** | — |
| 11 | The reconnect prompt names what that platform adds | met | **met** | `gains` per requirement (e.g. `:102` "Estimated revenue, split into ads and YouTube Premium"), shown by `platform-connections.tsx`; copy in `locales/en/platforms.json:46-59` | no |
| 12 | An unauthorised connection isn't retried forever | met | **met** | `syncEligibility` → `not_authorised`, skipped before the batch; guards C1–C3 RED | no |
| 13 | The audit covers all five platforms | met | **met** | `analytics-scopes.ts`: facebook (planned, FILM-1720) and twitter (`not_required`) rows present | no |
| 14 | Monetary scope requested; YouTube connections prompted to re-consent; only non-YPP creators are `account_type_gated` | met | **met in code** | `oauth/youtube/config.ts:17`; `review: 'approved'` for `youtube.revenue` (so the prompt shows); guards A4, B3, D1 RED. **Caveat:** "approved" rests on an uncited belief about Google's consent screen (vendor-review-status, "not checked"). Q4 | no |
| 15 | Monetary metrics fetched separately, so a 403 degrades revenue only | met | **met** | `youtube-analytics.ts` `fetchRevenue`; guards A6, B1, B2 RED. Plus: unmeasured revenue is never written (`analytics-sync-cron.ts:536`) | no |
| 16 | A real YPP channel's `revenue_records` holds non-zero `api` rows | not met | **not met** | needs a monetised channel's token: FILM-1725 Check G, after deploy | — |
| 17 | Whether YouTube rejects a mixed monetary query is established by a real call | not met | **not met** | FILM-1725 Check G. The split ships either way | — |
| 18 | YPP membership modelled as `account_type_gated` | met | **met** | `revenueAccess` → `recordRevenueGate` (`analytics-sync-cron.ts:540`); guard B3 RED | no |

**Totals:**
- **On main:** 14 met and still true, 1 met only as a dated probe (#8, now FILM-1723's in production), 4 not met.
- **Deployed:** 0.

---

## 4. Found while verifying

### 4.1 The spec's notes list three blockers that main has fixed

"What shipped, and what is still open (2026-09-22)" lists four things the owner needs before submitting. On main:

| Blocker | Status on main | Where |
|---|---|---|
| No data-deletion endpoint or instructions page (Meta) | **fixed**: `/data-deletion`, linked from the footer, with an E2E | #294, `162a0f1c` (2026-09-23); `apps/web/app/(marketing)/(legal)/data-deletion/page.tsx` |
| Privacy policy lacks YouTube's three required items (Google) | **fixed**: YouTube ToS link, Google Privacy Policy, security-settings revocation | #294; `privacy-policy/page.tsx:293,302,645` |
| A failed authorise redirects to a 404 and logs nothing | **fixed** (KB-19) | #297, `11d56e65`; runbook item 4 already says so |
| Meta Standard Access covers the owner's own accounts | a fact, not a blocker | unchanged |

`docs/vendor-review-runbook.md` already reflects this (lines 49-62). The spec's notes and its `remaining` don't: the fix is records only. All three are merged, not deployed, so they're on the same deploy as #289. A Meta or Google submission that points reviewers at `/data-deletion` needs that deploy first.

### 4.2 FILM-1726's "live correctness concern" is resolved by #289

FILM-1726 (`FILM-1726-monetisation-stage.yaml:98-104`) says that without the monetary scope "we write zero-valued api rows — figures marked authoritative that measure nothing … it may belong in FILM-1711 rather than here. Decide which."

On main, two things close it:
- The sync writes revenue only when it was measured (`if (normalizedData.revenue_measured)`, `analytics-sync-cron.ts:536`). YouTube without the scope is `revenue_measured: false`.
- `planRevenueRowWrites` (`content-analytics/src/lib/revenue-mix.ts:128`) never **inserts** a zero, and only writes a zero to correct an existing row.

TikTok and Instagram still pass `revenue_measured: true` with hardcoded zeros. That's deliberate, and harmless under the no-insert rule: those zeros can only correct an existing `api` row, and none exists for those platforms. **Proposed:** FILM-1726's note is updated to say FILM-1711 closed it, and why (records only).

### 4.3 LinkedIn's callback records the requested scopes as granted (lead)

`apps/web/app/api/platforms/callback/linkedin/route.ts:164-181` writes `LINKEDIN_OAUTH_CONFIG.scopes.*` into `platform_connections.scopes`. That's the shape #289 removed from the five analytics platforms because it "would have marked every new connection authorised".
- LinkedIn has no analytics provider and no requirement in `analytics-scopes.ts`, so `resolveAnalyticsAccess` returns `no_provider` and **nothing reads the column for LinkedIn today**.
- It becomes a defect the day a LinkedIn analytics provider is added.
- Read, not run, so a **lead**, not a KB: `specs/known-bugs/leads/2026-09-25-film-1711.md`.

### 4.4 FILM-1715 isn't a dependent

`FILM-1715-self-benchmarking.yaml` depends on FILM-1703, 1713, 1716 and 1721. INDEX row 607 agrees, and in the README's graph (`README.md:40-47`) FILM-1715 hangs off FILM-1721, not FILM-1711. The dependents are **1712, 1720, 1726, 1727, 1730**, plus FILM-1710's TikTok leg (INDEX row 602).

---

## 5. What closes FILM-1711

Everything left is outside the repo except the records work in §6.

| Step | Who | When | What it closes |
|---|---|---|---|
| 1. Confirm the deployed commit (Q1) | owner | now, one look | whether §2 is inference or fact |
| 2. **FILM-1725 Check F**, runbook Part 1: in each vendor console confirm the new scopes are added to the app; one staging connect per platform with the new configs | owner | **before** the deploy carrying #289 | the risk that TikTok (or Meta) rejects the authorise request and breaks connecting at all |
| 3. Deploy (#289 with #284, #294, #297 and the rest of the wave) | owner | after step 2 | "deployed" for criteria 1-4, 6, 7, 9, 11-15, 18 |
| 4. FILM-1725 Check D (Meta refresh on the pinned version) | owner | at that deploy | FILM-1723's open criterion, and #8's production half |
| 5. Reconnect YouTube; FILM-1725 **Check G** | owner | after deploy | #16, #17, and whether the non-YPP 403 reading is right |
| 6. Submit Meta App Review + Business Verification; TikTok app review | owner | any time; clocks are the vendors' | #5; then flip `review` in code and in `vendor-review-status.md` together (guard D6) |
| 7. FILM-1725 **Check H** (real TikTok and Instagram data) | owner | after each review passes | the spec's own verification section |
| 8. Re-home #10 (Q2) | lead/owner | with §6 | #10 |

**DONE when:** steps 1–7 are recorded and #10 is re-homed. Until then the honest status stays **PARTIAL**, now with `remaining` saying precisely which step closes which item and that nothing is deployed.

---

## 6. The engineering work: records only

One small docs PR, `docs(specs): FILM-1711 verified on main; merged vs deployed; dependents re-pointed`.

- **`FILM-1711-analytics-authorisation.yaml`**
  - Each met criterion's `evidence` re-pointed to current lines, via `pnpm specs:citations`.
  - A **Deployment** section in `notes`: production at `d8c635c1` (inferred, Q1), #289 not deployed, no migration to detect it by, and the deploy order Check F → deploy → Checks D/G.
  - `remaining` rewritten as §5's rows, with `closed_by` set to `owner` or `FILM-1725` for each.
  - The three runbook blockers marked fixed (#294, #297).
  - Criterion #10 marked "moved to FILM-1705" if Q2 says so.
  - Criterion #8 annotated as superseded by FILM-1723 for production.
- **FILM-1705** (if Q2 = move): gains the criterion "`not_authorised` is distinguishable from `no_data_in_window` everywhere both appear", with a note that FILM-1711 provides `not_authorised` (`AnalyticsAccess.summary`).
- **FILM-1712, 1720, 1726, 1727, 1730:** the dependency note for FILM-1711 becomes `"#289's code (merged 2026-09-22). Live verification is FILM-1725 Checks F–H, not this dependency"` (Q3).
- **FILM-1726:** the "zero is being written as authoritative" paragraph gains "Resolved by FILM-1711 (#289): unmeasured revenue is not written, and no zero is ever inserted", with the two citations.
- **FILM-1710** (TikTok leg): same note as the dependents.
- **Leads file:** §4.3.
- **Checks:** `pnpm specs:citations`, the `@kit/shared` suite (spec schema, KB-80 closed-by drift, index counts), `pnpm specs:index --write` if a count moves. No code, so no typecheck or E2E.

**Not proposed:**
- Any code change. The LinkedIn lead stays a lead until a LinkedIn provider is specced.
- Re-running the E1 E2E guard or `analytics-access.spec.ts`, which would need the shared DB. If the lead wants them re-seen before the batch run, it's one short hold (about 5 minutes).

---

## 7. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| The deploy ships #289 without Check F, and TikTok rejects the authorise request | Connecting TikTok, and so publishing to it, breaks for everyone | Step 2 before step 3. The runbook's Part 1 is that check; the deploy notes should list it first |
| Google shows an unverified-app warning for the monetary scope | YouTube reconnects stall at a warning while the page invites them (`review: 'approved'`) | Q4. If seen, set `review: 'pending'` for `youtube.revenue` (withdraws the prompt) |
| The dependents are held on vendor queues with no timeline | Five DRAFT specs wait on Meta and TikTok | Q3: depend on the code, verify via FILM-1725 |
| "Deployed" stays an inference | Specs keep saying "shipped" about behaviour production lacks | Q1, and the Deployment section in the spec |

---

## 8. Open questions

- **Q1 (owner):** is production on `d8c635c1`-era code? One look at the deployed commit. The same question as FILM-1723's Q1, and one answer serves both. *Assumed yes.*
- **Q2 (lead/owner):** move criterion #10 (`not_authorised` vs `no_data_in_window`) to FILM-1705, where the two states first share a surface? *Recommended: yes.* FILM-1711 can't close it: the second state doesn't exist, and its owner is DRAFT.
- **Q3 (lead):** re-point the five dependents' notes to "#289's code", so FILM-1711's PARTIAL (vendor queues) doesn't hold them in DRAFT? *Recommended: yes*, as FILM-1723's EDD proposed for its dependents.
- **Q4 (owner, in the Google console):** is `yt-analytics-monetary.readonly` on the OAuth consent screen? If not, and users would see an unverified-app warning, `youtube.revenue` should be `review: 'pending'` until it is. This decides whether the post-deploy YouTube reconnect prompt is right to show.

---

## 9. Consistency pass

- **Forward:**
  - The user needs analytics that says what it can't read, and gets it on main.
  - Production has none of it: not deployed.
  - What stands between them is owner actions in a fixed order (Check F before the deploy) and vendor reviews.
  - The repo's part is records that say so.
- **Reverse:**
  - The production build deployed next will request the new scopes, record granted scopes, split revenue, skip unauthorised syncs and show the page states.
  - The criteria verified here describe exactly that.
  - The only behaviour that could differ from the user flow in §1 is a vendor rejecting the authorise request: Check F, first.
