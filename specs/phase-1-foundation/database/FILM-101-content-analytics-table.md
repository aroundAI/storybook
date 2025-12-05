# FILM-101 Content Analytics Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Dependencies:** FILM-101 (publishes-table)
- **Blocks:** FILM-801 (analytics-sync), FILM-802 (analytics-dashboard)

## Context
The `content_analytics` table stores daily snapshots of content performance across platforms. Each row represents metrics for a specific publish on a specific date, enabling time-series analysis and performance tracking.

## Specification

### Table Definition
```sql
CREATE TABLE content_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  publish_id UUID NOT NULL REFERENCES publishes(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  views BIGINT DEFAULT 0 NOT NULL,
  likes BIGINT DEFAULT 0 NOT NULL,
  comments BIGINT DEFAULT 0 NOT NULL,
  shares BIGINT DEFAULT 0 NOT NULL,
  watch_time_seconds BIGINT DEFAULT 0 NOT NULL,
  subscribers_gained INTEGER DEFAULT 0 NOT NULL,
  revenue_cents INTEGER DEFAULT 0 NOT NULL,
  retention_data JSONB,
  raw_data JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(publish_id, snapshot_date)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| publish_id | UUID | NO | - | Foreign key to publishes |
| snapshot_date | DATE | NO | - | Date of this snapshot |
| views | BIGINT | NO | 0 | Total views |
| likes | BIGINT | NO | 0 | Total likes/reactions |
| comments | BIGINT | NO | 0 | Total comments |
| shares | BIGINT | NO | 0 | Total shares/reposts |
| watch_time_seconds | BIGINT | NO | 0 | Total watch time |
| subscribers_gained | INTEGER | NO | 0 | New subscribers from this content |
| revenue_cents | INTEGER | NO | 0 | Revenue generated (monetization) |
| retention_data | JSONB | YES | NULL | Audience retention curve |
| raw_data | JSONB | YES | NULL | Platform-specific raw metrics |
| created_at | TIMESTAMPTZ | NO | NOW() | Snapshot creation time |

### Indexes
```sql
CREATE INDEX idx_content_analytics_publish_id ON content_analytics(publish_id);
CREATE INDEX idx_content_analytics_snapshot_date ON content_analytics(snapshot_date DESC);
CREATE INDEX idx_content_analytics_publish_date ON content_analytics(publish_id, snapshot_date DESC);
CREATE INDEX idx_content_analytics_views ON content_analytics(views DESC);
```

### Constraints
- **Primary Key**: `id`
- **Unique**: `(publish_id, snapshot_date)` - one snapshot per day
- **Foreign Key**: `publish_id` references `publishes(id)` ON DELETE CASCADE

### JSONB Schema

```typescript
interface RetentionData {
  percentages: number[];      // Retention % at each 10% mark [100, 95, 85, 75, ...]
  avgViewDuration: number;    // Average view duration in seconds
  avgPercentageWatched: number; // Average % of video watched
}

interface RawData {
  // YouTube-specific
  youtube?: {
    estimatedMinutesWatched: number;
    averageViewPercentage: number;
    clickThroughRate: number;
    impressions: number;
    trafficSources: {
      [key: string]: number; // "BROWSE_FEATURES": 1234, "YT_SEARCH": 567
    };
    demographics: {
      age: { [key: string]: number };
      gender: { male: number; female: number };
      geography: { [country: string]: number };
    };
  };

  // TikTok-specific
  tiktok?: {
    totalPlayTime: number;
    reachCount: number;
    averageWatchTime: number;
    fullVideoWatched: number;
    finishRate: number;
    soundUsages: number;
  };

  // Instagram-specific
  instagram?: {
    reach: number;
    impressions: number;
    savedCount: number;
    replaysCount: number;
    accountsEngaged: number;
  };

  // Platform-agnostic
  engagementRate?: number;    // (likes + comments + shares) / views
  viralityScore?: number;     // shares / views
}
```

### Example Data
```sql
-- Daily snapshot for YouTube publish
INSERT INTO content_analytics (
  publish_id,
  snapshot_date,
  views,
  likes,
  comments,
  shares,
  watch_time_seconds,
  subscribers_gained,
  revenue_cents,
  retention_data,
  raw_data
) VALUES (
  'publish-123',
  '2025-12-04',
  15234,
  892,
  134,
  67,
  458102,  -- ~127 hours
  45,
  1250,    -- $12.50
  '{
    "percentages": [100, 95, 88, 82, 75, 68, 60, 52, 45, 38],
    "avgViewDuration": 180,
    "avgPercentageWatched": 45
  }',
  '{
    "youtube": {
      "estimatedMinutesWatched": 7635,
      "averageViewPercentage": 45.2,
      "clickThroughRate": 8.5,
      "impressions": 45000,
      "trafficSources": {
        "BROWSE_FEATURES": 6500,
        "YT_SEARCH": 4200,
        "SUGGESTED_VIDEOS": 3800
      }
    },
    "engagementRate": 7.2
  }'
);
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created with all columns
- [ ] Foreign key with CASCADE delete
- [ ] Unique constraint on (publish_id, snapshot_date)
- [ ] Indexes for date range queries
- [ ] BIGINT columns for high view counts
- [ ] Revenue tracking in cents

## Test Plan

### Unit Tests
- [ ] Insert snapshot with valid publish_id succeeds
- [ ] Insert duplicate snapshot for same date fails (unique constraint)
- [ ] Insert snapshot with all metrics = 0 succeeds
- [ ] JSONB retention_data and raw_data accept valid JSON

### Integration Tests
- [ ] Deleting publish cascades to delete analytics
- [ ] Query snapshots for date range
- [ ] Calculate growth metrics (day-over-day, week-over-week)
- [ ] Aggregate metrics across multiple publishes

### Analytics Queries
```sql
-- Get latest snapshot for each publish
SELECT DISTINCT ON (publish_id)
  publish_id,
  snapshot_date,
  views,
  likes,
  watch_time_seconds
FROM content_analytics
ORDER BY publish_id, snapshot_date DESC;

-- Calculate day-over-day view growth
WITH daily_views AS (
  SELECT
    publish_id,
    snapshot_date,
    views,
    LAG(views) OVER (PARTITION BY publish_id ORDER BY snapshot_date) AS prev_views
  FROM content_analytics
)
SELECT
  publish_id,
  snapshot_date,
  views - prev_views AS views_gained_today
FROM daily_views
WHERE prev_views IS NOT NULL;

-- Top performing content by engagement rate
SELECT
  p.title,
  ca.views,
  ca.likes,
  ca.comments,
  (ca.likes + ca.comments + ca.shares)::FLOAT / NULLIF(ca.views, 0) AS engagement_rate
FROM content_analytics ca
JOIN publishes p ON ca.publish_id = p.id
WHERE ca.snapshot_date = CURRENT_DATE - 1
ORDER BY engagement_rate DESC
LIMIT 10;
```

### Edge Cases
- [ ] Very high view counts (billions - TikTok viral)
- [ ] Negative subscribers_gained (net loss)
- [ ] Zero views (new publish)
- [ ] NULL retention_data (not available from platform)
- [ ] Partial raw_data (some metrics unavailable)
