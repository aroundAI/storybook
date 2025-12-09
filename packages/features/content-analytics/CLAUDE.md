# Content Analytics Package

Provides analytics providers for fetching performance metrics from social media platforms.

## Package Structure

- `providers/youtube/` - YouTube Analytics API integration
- `providers/tiktok/` - TikTok Creator Tools API integration
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
  YouTubeAnalyticsInput,
  YouTubeAnalyticsResult,
  YouTubeTotals,
  YouTubeDailyMetrics,
  RetentionData,
  DemographicData,
  TrafficSourceData,
  GeographyData,
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
// - totals: views, likes, comments, shares, saves, watch time
// - dailyData: empty (TikTok doesn't provide per-video daily breakdown)
// - audience: geographic/demographic data (optional)
// - trafficSources: For You, Following, Sound, etc.

// Get account-level analytics
const accountStats = await provider.getAccountAnalytics();
// Returns: followers, followersGained, profileViews, videoViews
```

### Types

```typescript
import type {
  TikTokAnalyticsInput,
  TikTokAnalyticsResult,
  TikTokTotals,
  TikTokDailyMetrics,
  TikTokAudienceData,
  TikTokTrafficSource,
  TikTokAccountAnalytics,
} from '@kit/content-analytics/providers/tiktok';
```

### TikTok API Limitations

- Rate limit: 1000 requests/day
- Daily breakdown not available per-video
- Some metrics only available for Creator accounts
- Limited metrics compared to YouTube

### TikTok OAuth Scopes Required

- `creator.info` - Basic creator information
- `video.list` - List creator's videos
- `video.query` - Query video analytics
- `research.creator_insights` - Get audience demographics (optional)

## API Rate Limits

- **YouTube Analytics API**: 200 queries/day per project
- **TikTok Creator Tools API**: 1000 requests/day
- Batch requests where possible
- Cache responses to reduce API calls

## OAuth Scopes Required

The YouTube connection must include these scopes:
- `youtube.readonly` - For video metadata
- `yt-analytics.readonly` - For analytics data (added in FILM-801)

## Error Handling

| Error | Behavior |
|-------|----------|
| `YouTubeAnalyticsScopeError` | Thrown when connection is missing analytics scope - user must reconnect |
| `quotaExceeded` | Throws error - caller should queue for later |
| `forbidden` | Throws error - token may need re-auth |
| `notFound` | Throws error for getVideoInfo, returns undefined for optional fields |
| Missing data | Returns `undefined` for optional fields (retention, demographics) |
| `TikTokAnalyticsScopeError` | Thrown when TikTok connection is missing required scopes |
| `TikTokVideoNotFoundError` | Thrown when video is not found |
| `TikTokRateLimitError` | Thrown when rate limited - retry later |

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

## Dependencies

- `googleapis` - Google API client library

## Testing

```bash
# Run tests
pnpm --filter @kit/content-analytics test

# Run with coverage
pnpm --filter @kit/content-analytics test:coverage
```
