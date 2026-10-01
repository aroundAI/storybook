# Content Analytics Package

Provides analytics providers for fetching performance metrics from social media platforms.

## Package Structure

- `providers/youtube/` - YouTube Analytics API integration
- `providers/tiktok/` - TikTok Creator Tools API integration
- `providers/instagram/` - Instagram Insights API integration
- `providers/facebook/` - Facebook Page video insights (FILM-1720). Shipped
  dark: its scopes are requested only once `ANALYTICS_SCOPES_ENABLED` names
  `facebook`. A Facebook row has **no `views`** (NULL, migration 020): its
  kinds of view are their own columns, and a reader that counts videos or
  shows views per platform must say "not measured" for it, never 0 (KB-153)
- `lib/` - Shared utilities

## YouTube Analytics Provider

### Usage

```typescript
import {
  YouTubeAnalyticsProvider,
  createYouTubeAnalyticsProvider,
} from '@kit/content-analytics/providers/youtube';

// Create provider with access token
const provider = createYouTubeAnalyticsProvider(accessToken);

// Fetch comprehensive analytics for a video
const analytics = await provider.getVideoAnalytics({
  videoId: 'abc123xyz',
  startDate: new Date('2025-01-01'),
  endDate: new Date('2025-01-31'),
});

// Result includes:
// - totals: views, likes, comments, shares, watch time, revenue, etc.
// - dailyData: daily breakdown of key metrics
// - retention: audience retention curve (optional)
// - demographics: age/gender breakdown (optional)
// - trafficSources: where viewers came from
// - geography: country-level breakdown

// Get video metadata
const videoInfo = await provider.getVideoInfo('abc123xyz');
// Returns: title, thumbnailUrl, publishedAt, duration
```

### Types

```typescript
import type {
  DemographicData,
  GeographyData,
  RetentionData,
  TrafficSourceData,
  YouTubeAnalyticsInput,
  YouTubeAnalyticsResult,
  YouTubeDailyMetrics,
  YouTubeTotals,
} from '@kit/content-analytics/providers/youtube';
```

## TikTok Analytics Provider

### Usage

```typescript
import {
  TikTokAnalyticsProvider,
  createTikTokAnalyticsProvider,
} from '@kit/content-analytics/providers/tiktok';

// Create provider with access token
const provider = createTikTokAnalyticsProvider(accessToken);

// Fetch video analytics
const analytics = await provider.getVideoAnalytics({
  videoId: 'video123',
  dateRange: 7, // Optional: 7 or 28 days (default: 7)
});

// Result includes:
// - totals: views, likes, comments, shares. Saves, watch time and
//   traffic sources are structurally zero - Business API only.
// - dailyData: empty (TikTok doesn't provide per-video daily breakdown)
// - audience: always undefined; no authorisable demographics surface
// - trafficSources: always empty; `impression_sources` is Business API only

// Get account-level analytics
const accountStats = await provider.getAccountAnalytics();
// Returns: followers, followersGained, profileViews, videoViews
```

### Types

```typescript
import type {
  TikTokAccountAnalytics,
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokAudienceData,
  TikTokDailyMetrics,
  TikTokTotals,
  TikTokTrafficSource,
} from '@kit/content-analytics/providers/tiktok';
```

### TikTok API Limitations

- Rate limit: 600 requests/minute per endpoint (Display API)
- Daily breakdown not available per-video
- Some metrics only available for Creator accounts
- Limited metrics compared to YouTube

### TikTok OAuth Scopes Required

- `user.info.basic` - Basic creator information
- `video.list` - List and query the creator's own videos
- `user.info.stats` - `follower_count`, which left `user.info.basic` on 2024-02-29

These are declared in `packages/features/publishing/src/oauth/analytics-scopes.ts`,
and `__tests__/analytics-scope-binding.test.ts` fails a provider call whose scope
the OAuth config does not request (FILM-1711). Add the requirement there before
adding the call.

There is **no `video.query` scope**, and `research.creator_insights` is not a
real scope — TikTok's research scopes are restricted to non-profit academic
researchers and carry no demographics endpoints. Audience demographics are not
reachable on any surface we can authorise. See
[docs/platform-capability-reference.md](../../../docs/platform-capability-reference.md).

## Asset duration (FILM-1710)

`publishes.duration_seconds` is the **published clip's** length as its platform
reports it; ClickHouse carries it as `video_dim.asset_duration_seconds`
(`Nullable`). `video_dim.episode_duration_seconds` is the episode's render — a
Short cut from a 22-minute episode has 45 in one and 1,320 in the other. They
are not interchangeable, and neither falls back to the other.

- **One writer per platform:** `syncAssetDurations` in
  `server/asset-duration-sync.ts` for YouTube and TikTok, called by the hourly
  sync for publishes still missing one and by
  `POST /api/analytics/asset-duration-backfill` for history; and, for
  Instagram, `recordUploadedFileDuration` (`@kit/publishing`), which measures
  the uploaded file's MP4 header at publish time. A database trigger keeps
  browser sessions from writing the column. Both only ever fill a null.
- **Sources:** YouTube `contentDetails.duration`
  (`YouTubeAnalyticsProvider.getVideoDurations`, 50 ids a call) and TikTok
  `duration` on `/v2/video/query/` (`TikTokAnalyticsProvider.getVideoDurations`,
  20 ids a call — needs `video.list`, so it is a `scope_missing` gap until
  FILM-1711). **Instagram has no duration field** and is never asked: its
  duration is the file we sent, or null when that file's header cannot be read.
- **Unknown is a state, not a zero.** Read a duration through `AssetDuration`
  (`lib/asset-duration.ts`): `{ known: true, seconds } | { known: false, reason:
'duration_unknown' }`. `retentionAtSeconds` and `detectRetentionCliff` take
  one, not a number, so an episode's duration cannot be passed by mistake.

```bash
# the real reconcile against local Postgres + ClickHouse (off by default)
set -a; . deployment/config/local.env; set +a
DIM_SYNC_LOCAL_STACK=1 pnpm --filter @kit/content-analytics test dim-sync.local-stack
```

## API Rate Limits

- **YouTube Analytics API**: cost is per query with no published number — read
  the project's own Cloud Console. The Reporting API has no meaningful quota
- **TikTok Display API**: 600 requests/minute per endpoint, 20 video IDs per request
- **Instagram**: `4800 × impressions` per 24h per app-and-user pair, so dormant
  creators throttle first

Sourced in [docs/platform-capability-reference.md](../../../docs/platform-capability-reference.md);
the figures previously here (1000/day, 200/day) had no citation.

- Batch requests where possible
- Cache responses to reduce API calls

## OAuth Scopes Required

The YouTube connection must include these scopes:

- `youtube.readonly` - For video metadata
- `yt-analytics.readonly` - For analytics data (added in FILM-801)
- `yt-analytics-monetary.readonly` - For the three revenue metrics (FILM-1711).
  They travel in their own query, made only when `includeRevenue` is passed, so a
  channel without the scope or outside the Partner Program keeps its totals.
  `result.revenueAccess` says which of those it was; in every state but
  `authorised` the revenue totals are 0 and mean "not measured"

## Error Handling

| Error                        | Behavior                                                                |
| ---------------------------- | ----------------------------------------------------------------------- |
| `YouTubeAnalyticsScopeError` | Thrown when connection is missing analytics scope - user must reconnect |
| `quotaExceeded`              | Throws error - caller should queue for later                            |
| `forbidden`                  | Throws error - token may need re-auth                                   |
| `notFound`                   | Throws error for getVideoInfo, returns undefined for optional fields    |
| Missing data                 | Returns `undefined` for optional fields (retention, demographics)       |
| `TikTokAnalyticsScopeError`  | Thrown when TikTok connection is missing required scopes                |
| `TikTokVideoNotFoundError`   | Thrown when video is not found                                          |
| `TikTokRateLimitError`       | Thrown when rate limited - retry later                                  |

### Handling Scope Errors

Users who connected their YouTube account before FILM-801 will not have the `yt-analytics.readonly` scope. When they try to use analytics features, a `YouTubeAnalyticsScopeError` is thrown:

```typescript
import {
  createYouTubeAnalyticsProvider,
  YouTubeAnalyticsScopeError,
} from '@kit/content-analytics/providers/youtube';

try {
  const analytics = await provider.getVideoAnalytics({ ... });
} catch (error) {
  if (error instanceof YouTubeAnalyticsScopeError) {
    // Prompt user to reconnect their YouTube account
    showReconnectDialog('Please reconnect your YouTube account to enable analytics.');
  }
  throw error;
}
```

## Instagram Insights Provider

### Usage

```typescript
import {
  InstagramInsightsProvider,
  createInstagramInsightsProvider,
} from '@kit/content-analytics/providers/instagram';

// Create provider with access token and Instagram account ID
const provider = createInstagramInsightsProvider(
  accessToken,
  instagramAccountId,
);

// Fetch insights for a Reel or Video
const insights = await provider.getMediaInsights({
  mediaId: '17895695668004550',
});

// Result includes:
// - totals: views, reach, likes, comments, saves, shares, etc.
// - audience: countries, cities, gender/age demographics

// Get account overview metrics
const accountInsights = await provider.getAccountInsights('week');
// Returns: views, reach (totals over the period), followerCount (null when absent)
```

### Types

```typescript
import type {
  InstagramAccountInsights,
  InstagramAudienceData,
  InstagramInsightsInput,
  InstagramInsightsResult,
  InstagramTotals,
} from '@kit/content-analytics/providers/instagram';
```

### Instagram API Requirements

- Requires Instagram Professional account (Business or Creator)
- Access token must have `instagram_basic`, `instagram_manage_insights` and
  `pages_read_engagement` — the Facebook Login triple, since we call
  `graph.facebook.com`
- 90-day data retention limit for insights

### Error Handling

| Error                         | Behavior                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------- |
| `InstagramInsightsScopeError` | Thrown when connection is missing insights permissions - user must reconnect |
| `OAuthException`              | Token expired - trigger re-auth                                              |
| Media not found               | Content deleted - throws error                                               |
| Missing data                  | Returns `undefined` for optional fields (audience)                           |

### Handling Scope Errors

```typescript
import {
  InstagramInsightsScopeError,
  createInstagramInsightsProvider,
} from '@kit/content-analytics/providers/instagram';

try {
  const insights = await provider.getMediaInsights({ mediaId: '...' });
} catch (error) {
  if (error instanceof InstagramInsightsScopeError) {
    // Prompt user to reconnect their Instagram account
    showReconnectDialog(
      'Please reconnect your Instagram account to enable analytics.',
    );
  }
  throw error;
}
```

## Revenue is per currency (KB-12) ⚠️

`revenue_records.currency` is a column, a channel can be paid in more than
one, and there are no exchange rates here. **Never add `revenue_cents`
across rows without looking at the currency** — `$12.00` and `€5.00` are not
`1700` of anything. Decided by the product owner (2026-09-22): one card per
currency; no FX, no base currency, no selector; a single-currency account
sees exactly what it always did.

- **One primitive: `src/lib/money.ts`.** `CurrencyAmount`, `MoneyByCurrency`,
  `createMoneyFold` / `foldMoney`, `createCurrencyPartition` (per-currency
  state for a fold that keeps more than one number), `formatCurrencyAmount` /
  `formatMoney` (`$12.00 + €5.00`). Do not write a second fold or formatter.
- **`forEachAccountRevenueRow` hands out `row.amount`**, not a bare number.
  Reaching for `row.amount.cents` to add it to another row's is the bug.
- **Shares, trends and RPM are computed within a currency**
  (`src/lib/revenue-by-currency.ts`). Never divide a mixed sum; if a chart
  cannot show two currencies on one axis, draw one per currency.
- **Alerts are per currency** (`revenue-alerts.ts`).
- **ClickHouse revenue is `video_revenue_daily`, USD by construction**
  (migration 022, FILM-1726) — no currency column, one writer: YouTube's
  estimate, requested without a `currency`, for a day it was measured.
  No row means not measured, so every reader of `video_daily_stats` gets
  `revenue_cents: number | null` — keep the null (`lib/estimated-revenue.ts`:
  `addRevenue`, `formatRevenueCents`), never `?? 0`. `video_metrics.revenue_cents`
  is NULL and unread. `__tests__/revenue-writers.test.ts` binds the writers;
  a new one fails it until listed. `formatCurrency` in `lib/format` is for
  those figures only.

## Dependencies

- `googleapis` - Google API client library (YouTube only)

## Testing

**The manual revenue form has browser coverage, and needs it.** Four review
rounds found defects in it that typecheck, lint and the unit suite all
passed — unsubmittable forms, a field that kept its text while form state
read zero. They live between the DOM and form state. Changes to
`manual-revenue-form.tsx` should be checked against
`apps/e2e/tests/revenue/`; see the E2E section of the root `CLAUDE.md` for
how these are written.

**`revenue-mix-card.tsx` is mounted by `revenue-dashboard.tsx`, once per
currency**, and covered in the browser by `revenue.spec.ts` ("Revenue mix")
and `revenue-currency.spec.ts`. Its logic lives in `lib/revenue-mix.ts` and
is unit-tested.

```bash
# Run tests
pnpm --filter @kit/content-analytics test

# Run with coverage
pnpm --filter @kit/content-analytics test:coverage
```
