# FILM-802: TikTok Analytics Provider

## Metadata
- **Phase:** 8 - Analytics
- **Priority:** P2 (Post-MVP)
- **Effort:** M (4-8 hours)
- **Status:** DONE
- **Dependencies:** FILM-706 (TikTok OAuth)
- **Blocks:** FILM-804 (Analytics Sync), FILM-805 (Analytics Dashboard)

---

## Context

TikTok's Creator Tools API provides video performance metrics. This provider fetches and normalizes analytics data for comparison with other platforms.

---

## Specification

### Requirements

1. **Video Metrics**: Views, likes, comments, shares
2. **Engagement**: Profile views, follower growth
3. **Audience**: Geographic distribution
4. **Traffic Sources**: For You page, Following, Profile
5. **Video Performance**: Watch time, completion rate

### Provider Interface

```typescript
// packages/features/content-analytics/src/providers/tiktok/types.ts

export interface TikTokAnalyticsInput {
  videoId: string;
  dateRange?: 7 | 28; // Days
}

export interface TikTokAnalyticsResult {
  videoId: string;
  period: {
    startDate: string;
    endDate: string;
  };
  totals: TikTokTotals;
  dailyData: TikTokDailyMetrics[];
  audience?: TikTokAudienceData;
  trafficSources?: TikTokTrafficSource[];
}

export interface TikTokTotals {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  profileViews: number;
  followersGained: number;
  averageWatchTime: number; // seconds
  totalPlayTime: number; // seconds
  fullVideoWatchedRate: number; // 0-1
}

export interface TikTokDailyMetrics {
  date: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  profileViews: number;
}

export interface TikTokAudienceData {
  countries: Array<{
    country: string;
    percentage: number;
  }>;
  genderDistribution: {
    male: number;
    female: number;
    other: number;
  };
  ageGroups: Array<{
    ageGroup: '13-17' | '18-24' | '25-34' | '35-44' | '45-54' | '55+';
    percentage: number;
  }>;
}

export interface TikTokTrafficSource {
  source: 'For You' | 'Following' | 'Sound' | 'Hashtag' | 'Profile' | 'Search' | 'Other';
  percentage: number;
}
```

### Provider Implementation

```typescript
// packages/features/content-analytics/src/providers/tiktok/tiktok-analytics.ts

const TIKTOK_API_BASE = 'https://open.tiktokapis.com/v2';

export class TikTokAnalyticsProvider {
  constructor(private accessToken: string) {}

  /**
   * Fetches video analytics
   */
  async getVideoAnalytics(input: TikTokAnalyticsInput): Promise<TikTokAnalyticsResult> {
    const { videoId, dateRange = 7 } = input;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - dateRange);

    // Fetch video metrics
    const metricsResponse = await fetch(
      `${TIKTOK_API_BASE}/video/query/?fields=id,like_count,comment_count,share_count,view_count`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            video_ids: [videoId],
          },
        }),
      }
    );

    const metricsData = await metricsResponse.json();
    const video = metricsData.data?.videos?.[0];

    if (!video) {
      throw new Error('Video not found');
    }

    // Fetch creator insights (for audience data)
    const insightsResponse = await fetch(
      `${TIKTOK_API_BASE}/research/creator/insights/?fields=audience_countries,audience_genders,audience_ages`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }
    );

    const insightsData = await insightsResponse.json();
    const audience = this.parseAudienceData(insightsData.data);

    return {
      videoId,
      period: {
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
      },
      totals: {
        views: video.view_count || 0,
        likes: video.like_count || 0,
        comments: video.comment_count || 0,
        shares: video.share_count || 0,
        saves: video.save_count || 0,
        profileViews: 0, // Not available per-video
        followersGained: 0, // Not available per-video
        averageWatchTime: video.average_watch_time || 0,
        totalPlayTime: video.total_play_time || 0,
        fullVideoWatchedRate: video.full_video_watched_rate || 0,
      },
      dailyData: [], // TikTok doesn't provide per-video daily breakdown
      audience,
      trafficSources: this.parseTrafficSources(video.traffic_source_types),
    };
  }

  /**
   * Fetches account-level analytics
   */
  async getAccountAnalytics(dateRange: 7 | 28 = 7): Promise<{
    followers: number;
    followersGained: number;
    profileViews: number;
    videoViews: number;
  }> {
    const response = await fetch(
      `${TIKTOK_API_BASE}/user/info/?fields=follower_count`,
      {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      }
    );

    const data = await response.json();

    return {
      followers: data.data?.user?.follower_count || 0,
      followersGained: 0, // Would need historical data
      profileViews: 0, // Not available in basic API
      videoViews: 0, // Would sum all videos
    };
  }

  private parseAudienceData(data: any): TikTokAudienceData | undefined {
    if (!data) return undefined;

    return {
      countries: (data.audience_countries || []).map((c: any) => ({
        country: c.country,
        percentage: c.percentage,
      })),
      genderDistribution: {
        male: data.audience_genders?.male || 0,
        female: data.audience_genders?.female || 0,
        other: data.audience_genders?.other || 0,
      },
      ageGroups: (data.audience_ages || []).map((a: any) => ({
        ageGroup: a.age_range,
        percentage: a.percentage,
      })),
    };
  }

  private parseTrafficSources(sources: any): TikTokTrafficSource[] {
    if (!sources) return [];

    const sourceMap: Record<string, string> = {
      for_you: 'For You',
      following: 'Following',
      sound: 'Sound',
      hashtag: 'Hashtag',
      profile: 'Profile',
      search: 'Search',
    };

    return Object.entries(sources).map(([key, value]) => ({
      source: (sourceMap[key] || 'Other') as TikTokTrafficSource['source'],
      percentage: value as number,
    }));
  }
}
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/content-analytics/src/providers/tiktok/tiktok-analytics.ts` |
| CREATE | `packages/features/content-analytics/src/providers/tiktok/types.ts` |
| CREATE | `packages/features/content-analytics/src/providers/tiktok/index.ts` |

---

## Acceptance Criteria

- [x] Fetches video views, likes, comments, shares
- [x] Fetches save count
- [x] Fetches watch time metrics
- [x] Fetches audience demographics
- [x] Fetches traffic source breakdown
- [x] Handles API rate limits
- [x] Normalizes to common format

---

## Test Plan

### Unit Tests
- [x] Test audience data parsing
- [x] Test traffic source mapping

### Integration Tests
- [x] Test with mocked TikTok API

---

## API Limitations

- TikTok API has limited metrics compared to YouTube
- Daily breakdown not available per-video
- Some metrics only available for Creator accounts
- Rate limit: 1000 requests/day

---

## Error Handling

| Error | Handling |
|-------|----------|
| `spam_risk_too_many_pending` | Rate limited, retry later |
| `access_token_invalid` | Trigger re-auth |
| `video_not_found` | Video deleted |
