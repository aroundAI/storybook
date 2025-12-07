# FILM-101 Publishes Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** FILM-101 (episodes-table, platform-connections-table)
- **Blocks:** FILM-703 (publish-actions), FILM-704 (analytics-sync)

## Context
The `publishes` table tracks published content across platforms. Each publish record links an episode to a platform connection and stores platform-specific metadata (video ID, URL, publish status).

## Specification

### Table Definition
```sql
CREATE TABLE publishes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  platform_connection_id UUID NOT NULL REFERENCES platform_connections(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  content_type VARCHAR(50) DEFAULT 'full' NOT NULL,
  platform_content_id VARCHAR(255),
  platform_url TEXT,
  title VARCHAR(500),
  description TEXT,
  tags TEXT[],
  thumbnail_url TEXT,
  status VARCHAR(50) DEFAULT 'draft' NOT NULL,
  scheduled_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin')),
  CHECK (content_type IN ('full', 'short', 'teaser', 'trailer')),
  CHECK (status IN ('draft', 'scheduled', 'publishing', 'published', 'failed', 'unlisted', 'deleted'))
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| episode_id | UUID | NO | - | Foreign key to episodes |
| platform_connection_id | UUID | NO | - | Foreign key to platform_connections |
| platform | VARCHAR(50) | NO | - | Platform name (denormalized for queries) |
| content_type | VARCHAR(50) | NO | 'full' | Content variant type |
| platform_content_id | VARCHAR(255) | YES | NULL | Platform's video/post ID |
| platform_url | TEXT | YES | NULL | Public URL on platform |
| title | VARCHAR(500) | YES | NULL | Publish title |
| description | TEXT | YES | NULL | Publish description |
| tags | TEXT[] | YES | NULL | Tags/hashtags |
| thumbnail_url | TEXT | YES | NULL | Custom thumbnail URL |
| status | VARCHAR(50) | NO | 'draft' | Publish status |
| scheduled_at | TIMESTAMPTZ | YES | NULL | Scheduled publish time |
| published_at | TIMESTAMPTZ | YES | NULL | Actual publish time |
| metadata | JSONB | YES | NULL | Platform-specific metadata |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Status Enum Values
- `draft` - Being prepared
- `scheduled` - Scheduled for future publish
- `publishing` - Currently uploading
- `published` - Successfully published
- `failed` - Publish failed
- `unlisted` - Published but unlisted
- `deleted` - Deleted from platform

### Content Type Values
- `full` - Full episode
- `short` - Short-form cut (TikTok/Reels)
- `teaser` - Promotional teaser
- `trailer` - Season/series trailer

### Indexes
```sql
CREATE INDEX idx_publishes_episode_id ON publishes(episode_id);
CREATE INDEX idx_publishes_platform_connection_id ON publishes(platform_connection_id);
CREATE INDEX idx_publishes_platform_status ON publishes(platform, status);
CREATE INDEX idx_publishes_scheduled_at ON publishes(scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'scheduled';
CREATE INDEX idx_publishes_platform_content_id ON publishes(platform, platform_content_id)
  WHERE platform_content_id IS NOT NULL;
```

### Constraints
- **Primary Key**: `id`
- **Foreign Keys**:
  - `episode_id` references `episodes(id)` ON DELETE CASCADE
  - `platform_connection_id` references `platform_connections(id)` ON DELETE CASCADE
- **Check Constraints**:
  - `platform` in enum values
  - `content_type` in enum values
  - `status` in enum values

### JSONB Schema

```typescript
interface PublishMetadata {
  // YouTube-specific
  youtube?: {
    videoId: string;
    categoryId: string;
    privacy: 'public' | 'unlisted' | 'private';
    madeForKids: boolean;
    monetizationSettings?: {
      enabled: boolean;
      adTypes: string[];
    };
  };

  // TikTok-specific
  tiktok?: {
    videoId: string;
    shareId: string;
    duetEnabled: boolean;
    stitchEnabled: boolean;
    commentEnabled: boolean;
  };

  // Instagram-specific
  instagram?: {
    mediaId: string;
    permalink: string;
    mediaType: 'REELS' | 'VIDEO';
    coverUrl?: string;
  };

  // Facebook-specific
  facebook?: {
    videoId: string;
    postId: string;
    targeting?: {
      countries?: string[];
      ageMin?: number;
      ageMax?: number;
    };
  };

  // Common fields
  processingStatus?: string;
  uploadProgress?: number;
  errorDetails?: {
    code: string;
    message: string;
  };
}
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created with all columns
- [ ] Foreign keys with CASCADE delete
- [ ] Status, platform, content_type enums enforced
- [ ] Indexes for scheduled publishes
- [ ] Can store platform-specific metadata

## Test Plan

### Unit Tests
- [ ] Insert with valid episode_id and platform_connection_id succeeds
- [ ] Insert with invalid status fails
- [ ] Insert with invalid platform fails
- [ ] NULL platform_content_id allowed (not yet published)
- [ ] Tags array stores correctly

### Integration Tests
- [ ] Deleting episode cascades to delete publishes
- [ ] Deleting platform_connection cascades to delete publishes
- [ ] Query scheduled publishes (scheduled_at < NOW, status = 'scheduled')
- [ ] Update status workflow (draft → scheduled → publishing → published)

### Status Workflow Test
```sql
-- Schedule a publish
INSERT INTO publishes (episode_id, platform_connection_id, platform, status, scheduled_at)
VALUES ('episode-id', 'connection-id', 'youtube', 'scheduled', '2025-12-10 10:00:00+00');

-- Mark as publishing
UPDATE publishes SET status = 'publishing' WHERE id = 'publish-id';

-- Mark as published
UPDATE publishes
SET
  status = 'published',
  published_at = NOW(),
  platform_content_id = 'dQw4w9WgXcQ',
  platform_url = 'https://youtube.com/watch?v=dQw4w9WgXcQ'
WHERE id = 'publish-id';
```
