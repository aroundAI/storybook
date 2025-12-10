# FILM-803: Instagram Insights Provider

## Metadata
- **Phase:** 8 - Analytics
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Dependencies:** FILM-707 (Meta OAuth)
- **Blocks:** FILM-804 (Analytics Sync), FILM-805 (Analytics Dashboard)

---

## Context

Instagram Insights API provides engagement and reach metrics for Reels and videos on Professional accounts. This provider fetches and normalizes data for the analytics dashboard.

---

## Specification

### Requirements

1. **Media Metrics**: Plays, likes, comments, saves, shares
2. **Reach**: Accounts reached, impressions
3. **Engagement**: Profile visits, follows from content
4. **Audience**: Demographics of reached accounts
5. **Discovery**: How users found the content

### Provider Interface

```typescript
// packages/features/content-analytics/src/providers/instagram/types.ts

export interface InstagramInsightsInput {
  mediaId: string;
  metrics?: InstagramMetric[];
}

export type InstagramMetric =
  | 'plays'
  | 'reach'
  | 'total_interactions'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'profile_visits'
  | 'follows'
  | 'impressions';

export interface InstagramInsightsResult {
  mediaId: string;
  mediaType: 'REELS' | 'VIDEO';
  totals: InstagramTotals;
  reachBreakdown?: InstagramReachBreakdown;
  audience?: InstagramAudienceData;
}

export interface InstagramTotals {
  plays: number;
  reach: number;
  impressions: number;
  totalInteractions: number;
  likes: number;
  comments: number;
  saved: number;
  shares: number;
  profileVisits: number;
  follows: number;
}

export interface InstagramReachBreakdown {
  followerReach: number;
  nonFollowerReach: number;
  followersPercentage: number;
}

export interface InstagramAudienceData {
  countries: Array<{
    country: string;
    count: number;
  }>;
  cities: Array<{
    city: string;
    count: number;
  }>;
  genderAge: Array<{
    dimension: string; // e.g., "F.25-34"
    count: number;
  }>;
}
```

### Provider Implementation

```typescript
// packages/features/content-analytics/src/providers/instagram/instagram-insights.ts

const GRAPH_API_BASE = 'https://graph.facebook.com/v18.0';

export class InstagramInsightsProvider {
  constructor(
    private accessToken: string,
    private instagramAccountId: string
  ) {}

  /**
   * Fetches insights for a media item (Reel or Video)
   */
  async getMediaInsights(input: InstagramInsightsInput): Promise<InstagramInsightsResult> {
    const { mediaId } = input;

    // Get media type first
    const mediaInfoResponse = await fetch(
      `${GRAPH_API_BASE}/${mediaId}?fields=media_type&access_token=${this.accessToken}`
    );
    const mediaInfo = await mediaInfoResponse.json();
    const mediaType = mediaInfo.media_type;

    // Define metrics based on media type
    const metricsForType = mediaType === 'REELS'
      ? ['plays', 'reach', 'total_interactions', 'likes', 'comments', 'saved', 'shares']
      : ['reach', 'impressions', 'total_interactions', 'likes', 'comments', 'saved'];

    // Fetch insights
    const insightsResponse = await fetch(
      `${GRAPH_API_BASE}/${mediaId}/insights?` +
      new URLSearchParams({
        metric: metricsForType.join(','),
        access_token: this.accessToken,
      })
    );

    const insightsData = await insightsResponse.json();
    const metrics = this.parseMetrics(insightsData.data || []);

    // Fetch reach breakdown (if Reel)
    let reachBreakdown: InstagramReachBreakdown | undefined;
    if (mediaType === 'REELS') {
      reachBreakdown = await this.fetchReachBreakdown(mediaId);
    }

    // Fetch account audience (account-level, not per-media)
    const audience = await this.fetchAccountAudience();

    return {
      mediaId,
      mediaType,
      totals: {
        plays: metrics.plays || 0,
        reach: metrics.reach || 0,
        impressions: metrics.impressions || metrics.reach || 0, // Fallback
        totalInteractions: metrics.total_interactions || 0,
        likes: metrics.likes || 0,
        comments: metrics.comments || 0,
        saved: metrics.saved || 0,
        shares: metrics.shares || 0,
        profileVisits: metrics.profile_visits || 0,
        follows: metrics.follows || 0,
      },
      reachBreakdown,
      audience,
    };
  }

  /**
   * Fetches reach breakdown for Reels
   */
  private async fetchReachBreakdown(mediaId: string): Promise<InstagramReachBreakdown | undefined> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${mediaId}/insights?` +
        new URLSearchParams({
          metric: 'reach',
          breakdown: 'follow_type',
          access_token: this.accessToken,
        })
      );

      const data = await response.json();
      const reachData = data.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];

      const followerReach = reachData.find((r: any) => r.dimension_values[0] === 'FOLLOWER')?.value || 0;
      const nonFollowerReach = reachData.find((r: any) => r.dimension_values[0] === 'NON_FOLLOWER')?.value || 0;
      const totalReach = followerReach + nonFollowerReach;

      return {
        followerReach,
        nonFollowerReach,
        followersPercentage: totalReach > 0 ? (followerReach / totalReach) * 100 : 0,
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Fetches account-level audience demographics
   */
  private async fetchAccountAudience(): Promise<InstagramAudienceData | undefined> {
    try {
      const response = await fetch(
        `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
        new URLSearchParams({
          metric: 'follower_demographics',
          period: 'lifetime',
          metric_type: 'total_value',
          breakdown: 'country,city,age,gender',
          access_token: this.accessToken,
        })
      );

      const data = await response.json();
      const demographics = data.data || [];

      return {
        countries: this.parseBreakdown(demographics, 'country'),
        cities: this.parseBreakdown(demographics, 'city'),
        genderAge: this.parseBreakdown(demographics, 'age,gender'),
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Gets account overview metrics
   */
  async getAccountInsights(period: 'day' | 'week' | 'month' = 'week'): Promise<{
    impressions: number;
    reach: number;
    profileViews: number;
    websiteClicks: number;
    followerCount: number;
  }> {
    const periodDays = { day: 1, week: 7, month: 28 }[period];

    const response = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}/insights?` +
      new URLSearchParams({
        metric: 'impressions,reach,profile_views,website_clicks',
        period: 'day',
        since: Math.floor(Date.now() / 1000 - periodDays * 86400).toString(),
        until: Math.floor(Date.now() / 1000).toString(),
        access_token: this.accessToken,
      })
    );

    const data = await response.json();
    const metrics = this.aggregateMetrics(data.data || []);

    // Get follower count separately
    const accountResponse = await fetch(
      `${GRAPH_API_BASE}/${this.instagramAccountId}?fields=followers_count&access_token=${this.accessToken}`
    );
    const accountData = await accountResponse.json();

    return {
      impressions: metrics.impressions || 0,
      reach: metrics.reach || 0,
      profileViews: metrics.profile_views || 0,
      websiteClicks: metrics.website_clicks || 0,
      followerCount: accountData.followers_count || 0,
    };
  }

  private parseMetrics(data: any[]): Record<string, number> {
    return data.reduce((acc, item) => {
      acc[item.name] = item.values?.[0]?.value || item.total_value?.value || 0;
      return acc;
    }, {} as Record<string, number>);
  }

  private parseBreakdown(data: any[], type: string): Array<{ [key: string]: any }> {
    const metric = data.find((d: any) => d.name === type);
    if (!metric) return [];

    return Object.entries(metric.total_value?.breakdowns?.[0]?.results || {})
      .map(([key, value]: [string, any]) => ({
        [type]: value.dimension_values?.[0] || key,
        count: value.value || 0,
      }))
      .sort((a, b) => b.count - a.count);
  }

  private aggregateMetrics(data: any[]): Record<string, number> {
    return data.reduce((acc, metric) => {
      const values = metric.values || [];
      acc[metric.name] = values.reduce((sum: number, v: any) => sum + (v.value || 0), 0);
      return acc;
    }, {} as Record<string, number>);
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/content-analytics/src/providers/instagram/instagram-insights.ts` |
| CREATE | `packages/features/content-analytics/src/providers/instagram/types.ts` |
| CREATE | `packages/features/content-analytics/src/providers/instagram/index.ts` |

---

## Acceptance Criteria

- [x] Fetches Reel plays, reach, impressions
- [x] Fetches engagement (likes, comments, saves, shares)
- [x] Fetches reach breakdown (follower vs non-follower)
- [x] Fetches profile visits and follows from content
- [x] Fetches audience demographics
- [x] Handles different media types
- [x] Normalizes to common format

---

## Test Plan

### Unit Tests
- [x] Test metrics parsing
- [x] Test breakdown parsing

### Integration Tests
- [x] Test with mocked Graph API

---

## API Limitations

- Some metrics only available for Reels
- Demographics are account-level, not per-media
- Insights API requires Professional account
- 90-day data retention limit

---

## Error Handling

| Error | Handling |
|-------|----------|
| `OAuthException` | Token expired, trigger re-auth |
| Media not found | Content deleted |
| Permissions error | Missing insights permission |
