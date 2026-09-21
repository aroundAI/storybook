---
spec_id: FILM-1725
title: Deferred Vendor Verifications
status: ⏸️ DEFERRED
effort: S
dependencies: FILM-1721
---

# Deferred Vendor Verifications

## 1. Why this exists

[FILM-1721](./FILM-1721-platform-capability-reference.md) named three empirical
checks, each able to falsify a row in the reference. One ran and resolved more
than expected. **Two could not run, for reasons that no amount of care would
have changed** — one needs a paid credential, the other an app registration.

Their answers are not unknowable. They are unknown *to us, today, at a price we
have not chosen to pay*. That is a different thing from an open research
question, and it deserves to be tracked rather than reasoned around. This spec
is where they wait.

**Deferred, not dropped.** The failure mode this prevents is the one FILM-1721
was written against: an unanswered question quietly becoming an assumed fact
because it sat in a prose paragraph nobody re-read. Each check below carries the
exact question, the exact command, what it blocks, and the event that should
bring it back.

**The reference is correct in the meantime.** Every claim that depends on one of
these checks is in FILM-1721's inferred ledger and must be labelled inferred
wherever it is used. Nothing here licenses filling a gap with a guess.

## 2. Check A — is `/2/media/analytics` callable below Enterprise?

**The single most consequential open question in the phase**, because it decides
whether X can be benchmarked past 30 days, and therefore whether X can enter the
signal model at all.

| | |
|---|---|
| **Question** | Does `GET /2/media/analytics` return data on a pay-per-use token, or 403? And what is its historical window? |
| **Status today** | *Inferred* that it is Enterprise-only |
| **Evidence for the inference** | An explicit comparison table on X's Enterprise introduction lists engagement metrics as Enterprise-only; neither endpoint appears as a billable line item on the pay-per-use schedule; `/2/media/analytics` is absent from the published rate-limit table |
| **Evidence against** | Both endpoints live in the standard `docs.x.com/x-api/` namespace and their own reference pages state **no tier requirement** |
| **Why it cannot be settled now** | X has no sandbox, and closed Free/Basic/Pro to new signups on **2026-02-06**. Only pay-per-use credits and Enterprise remain. The question *is* whether a non-Enterprise token works, so only a real token answers it |
| **Cost to settle** | One pay-per-use credit purchase. Enterprise pricing is unpublished; the widely-cited ~$42k/month figure is third-party, not X |
| **Blocks** | [FILM-1720](./FILM-1720-facebook-x-analytics.md) — the X half. Not the Facebook half |

```bash
# Settles the tier gate and, with a start_time beyond 30 days, the window.
# A 403 confirms the inference. A 200 falsifies the comparison table.
curl -s -H "Authorization: Bearer $X_PAY_PER_USE_TOKEN" \
  "https://api.x.com/2/media/analytics?media_keys=<key>&granularity=total&start_time=2026-01-01T00:00:00Z&end_time=2026-02-01T00:00:00Z"
```

**The 30-day wall is documented and is not in question.** *"Non-public, organic,
and promoted metrics are only available for posts created within the last 30
days"*, gated on the post's **creation date**, not the requested range. That
applies to the degraded `media.non_public_metrics` path, which is reachable on an
ordinary token. What is undocumented is the window on `/2/media/analytics`. The
legacy enterprise Engagement API allowed 365 days in 4-week spans — **a prior,
not a fact**, and it must not be written down as one.

**If the answer is Enterprise-only**, X's ceiling is `playback_0_count` …
`playback_100_count` and `view_count` on posts under 30 days old, with no watch
time and no time series. FILM-1720 should be planned against that, not against
the hope of the richer endpoint.

## 3. Check B — the TikTok Display API field list, confirmed live

| | |
|---|---|
| **Question** | Does `/v2/video/query/` return exactly the 16 documented fields, and does `duration` behave as the published asset's duration? |
| **Status today** | Documented; not empirically confirmed |
| **Why it did not run** | Needs a sandbox app with `video.list` granted to a test user. Registration is free and app review is **not** required for sandbox — so this one is cheap, and was left only because it is not on FILM-1721's critical path |
| **Cost to settle** | A free developer registration and a test video. Third-party reports put production app review at 1–2 weeks, but sandbox needs none |
| **Blocks** | Nothing outright. Confirms [FILM-1710](./FILM-1710-asset-duration.md)'s source for `duration`, and the field list [FILM-1712](./FILM-1712-metric-recovery.md) will request |

```bash
curl -s -X POST \
  "https://open.tiktokapis.com/v2/video/query/?fields=id,duration,view_count,like_count,comment_count,share_count" \
  -H "Authorization: Bearer $TIKTOK_SANDBOX_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filters":{"video_ids":["<test-video-id>"]}}'
```

A field named in the request but absent from the response body is a field the
vendor does not have — record it in the reference's *Names that must not appear
in our code* block, where the guard will then enforce it.

**This one should be folded into [FILM-1711](./FILM-1711-analytics-authorisation.md)
when that spec is picked up**, since FILM-1711 has to register the scope anyway
and will hold a working token. It is listed here so it is not lost if FILM-1711
slips.

## 4. What is *not* deferred

This spec covers questions we cannot answer. It does **not** cover work we simply
have not done, and the distinction matters — confusing the two is what a
"limited" label does to a creator.

The authorisation gaps FILM-1721 surfaced are ordinary work with known answers,
owned elsewhere:

| Gap | Owner |
|---|---|
| TikTok requests `user.info.basic` + `video.upload`, but the analytics code calls `/v2/video/query/` and `/v2/user/info/` | FILM-1711 |
| Meta requests `instagram_basic` + `instagram_content_publish`, but the insights code calls `/{media-id}/insights` | FILM-1711 |
| YouTube requests `yt-analytics.readonly` but not `yt-analytics-monetary.readonly`, while `fetchTotals` asks for three revenue metrics | FILM-1711 |
| No Facebook or X analytics provider exists in code at all | FILM-1720 |
| Graph v18.0 (expired 2026-01-26) and v19.0 (expired 2026-05-21) are both pinned in live code | FILM-1723 |

None of those needs a vendor answer. They need a decision and an afternoon.

## 5. When to bring this back

Un-defer **Check A** on any of:

- FILM-1720 is scheduled, and its X half needs a plan that is not a guess
- Someone buys X pay-per-use credits for any reason — the check costs one call
- X publishes tier information for the analytics endpoints, or changes its
  access tiers again (it has done so twice since 2025)

Un-defer **Check B** on any of:

- FILM-1711 starts — fold it in rather than running it separately
- FILM-1710's TikTok leg is picked up and wants `duration` confirmed

**Re-read this spec when phase 17's signal half is planned.** If either check is
still unanswered then, the decision is to plan against the pessimistic reading
and say so, not to defer again silently.

## 6. Acceptance criteria

This spec is complete when both checks have been run and their answers recorded
— not when a decision is made to skip them.

- [ ] Check A run, and its result recorded in FILM-1721's ledger with a date
- [ ] If Enterprise-only is confirmed, the `/2/media/analytics` field names are
      removed from the reference's `x/enterprise-analytics` block or marked
      unreachable, so the guard stops treating them as requestable
- [ ] If it is *not* Enterprise-only, the historical window is measured and the
      "30d from post creation" ceiling is restated per endpoint
- [ ] Check B run, and any field the endpoint does not return is added to the
      reference's forbidden block
- [ ] `docs/platform-capability-reference.md` open-questions table no longer
      lists either check, and every row it *does* list still names an owner

## 7. Risk

The risk is not that these go unanswered. It is that the phase gets planned as
though they were answered optimistically — an X integration scoped against
`/2/media/analytics`, a TikTok field list taken as confirmed — and the cost
surfaces during implementation instead of during planning. That is the exact
shape of the mistake FILM-1721 exists to prevent, which is why these are a
tracked spec and not a bullet in a README.
