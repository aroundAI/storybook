# Content Analytics Package

Provides analytics providers for fetching performance metrics from social media platforms.

## Package Structure

- `providers/youtube/` - YouTube Analytics API integration
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

## API Rate Limits

- **YouTube Analytics API**: 200 queries/day per project
- Batch requests where possible
- Cache responses to reduce API calls

## OAuth Scopes Required

The YouTube connection must include these scopes:
- `youtube.readonly` - For video metadata
- `yt-analytics.readonly` - For analytics data (added in FILM-801)

## Error Handling

| Error | Behavior |
|-------|----------|
| `quotaExceeded` | Throws error - caller should queue for later |
| `forbidden` | Throws error - token may need re-auth |
| `notFound` | Throws error for getVideoInfo, returns undefined for optional fields |
| Missing data | Returns `undefined` for optional fields (retention, demographics) |

## Dependencies

- `@kit/publishing` - For token refresh integration (future)
- `googleapis` - Google API client library

## Testing

```bash
# Run tests
pnpm --filter @kit/content-analytics test

# Run with coverage
pnpm --filter @kit/content-analytics test:coverage
```
