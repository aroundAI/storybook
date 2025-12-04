# FILM-101 Audio Tracks Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Dependencies:** FILM-101 (episodes-table)
- **Blocks:** FILM-504 (music-generation-action), FILM-505 (audio-studio)

## Context
The `audio_tracks` table stores music, sound effects, and composite dialogue tracks for episodes. Tracks have timeline positioning (start time, duration, volume) for the edit suite.

## Specification

### Table Definition
```sql
CREATE TABLE audio_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  file_url TEXT,
  duration_seconds DECIMAL(10, 2),
  timeline_start_seconds DECIMAL(10, 2) DEFAULT 0 NOT NULL,
  volume DECIMAL(3, 2) DEFAULT 1.0 NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (type IN ('music', 'sfx', 'dialogue_composite', 'ambient')),
  CHECK (volume >= 0.0 AND volume <= 2.0),
  CHECK (timeline_start_seconds >= 0),
  CHECK (duration_seconds > 0)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| episode_id | UUID | NO | - | Foreign key to episodes |
| type | VARCHAR(50) | NO | - | Track type (see enum) |
| name | VARCHAR(255) | YES | NULL | Track name/description |
| file_url | TEXT | YES | NULL | URL to audio file |
| duration_seconds | DECIMAL(10,2) | YES | NULL | Track duration |
| timeline_start_seconds | DECIMAL(10,2) | NO | 0 | Start position in timeline |
| volume | DECIMAL(3,2) | NO | 1.0 | Volume level (0.0-2.0) |
| metadata | JSONB | YES | NULL | Additional track metadata |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Type Enum Values
- `music` - Background music tracks
- `sfx` - Sound effects
- `dialogue_composite` - Merged dialogue track
- `ambient` - Ambient/environmental sounds

### Indexes
```sql
CREATE INDEX idx_audio_tracks_episode ON audio_tracks(episode_id);
CREATE INDEX idx_audio_tracks_type ON audio_tracks(episode_id, type);
```

### Constraints
- **Primary Key**: `id`
- **Foreign Key**: `episode_id` references `episodes(id)` ON DELETE CASCADE
- **Check Constraints**:
  - `type` in enum values
  - `volume` between 0.0 and 2.0
  - `timeline_start_seconds` >= 0
  - `duration_seconds` > 0

### JSONB Schema

```typescript
interface AudioTrackMetadata {
  provider?: string;          // "suno", "elevenlabs", "uploaded"
  genre?: string;             // For music tracks
  mood?: string;              // "upbeat", "somber", "intense"
  bpm?: number;               // Beats per minute
  fadeIn?: number;            // Fade in duration (seconds)
  fadeOut?: number;           // Fade out duration (seconds)
  loop?: boolean;             // Should track loop
  generatedAt?: string;       // ISO timestamp
  costCents?: number;         // Generation cost
}
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created with all columns
- [ ] Foreign key with CASCADE delete
- [ ] Type enum constraint enforced
- [ ] Volume constraint (0.0-2.0) enforced
- [ ] Check constraints prevent negative values
- [ ] Indexes created

## Test Plan

### Unit Tests
- [ ] Insert with valid episode_id succeeds
- [ ] Insert with invalid type fails
- [ ] Insert with volume > 2.0 fails
- [ ] Insert with negative timeline_start_seconds fails
- [ ] Insert with duration_seconds = 0 fails

### Integration Tests
- [ ] Deleting episode cascades to delete tracks
- [ ] Query tracks by type
- [ ] Order tracks by timeline_start_seconds
