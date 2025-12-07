# FILM-101 Generation Jobs Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** M
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** None (depends on existing projects table)
- **Blocks:** FILM-405 (generate-video-action), FILM-407 (kling-webhook), FILM-502 (voice-generation-action)

## Context
The `generation_jobs` table tracks all AI generation requests (video, voice, music, story, screenplay). It implements retry logic, idempotency, cost tracking, and dead letter queue for failed jobs.

## Specification

### Table Definition
```sql
CREATE TABLE generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key VARCHAR(255) UNIQUE NOT NULL,
  account_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_type VARCHAR(50) NOT NULL,
  reference_type VARCHAR(50),
  reference_id UUID,
  provider VARCHAR(50),
  provider_job_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'queued' NOT NULL,
  priority INTEGER DEFAULT 0 NOT NULL,
  input_data JSONB NOT NULL,
  output_data JSONB,
  error_message TEXT,
  error_code VARCHAR(100),
  retry_count INTEGER DEFAULT 0 NOT NULL,
  max_retries INTEGER DEFAULT 3 NOT NULL,
  next_retry_at TIMESTAMPTZ,
  timeout_seconds INTEGER DEFAULT 300 NOT NULL,
  cost_cents INTEGER,
  estimated_cost_cents INTEGER,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (job_type IN ('video', 'voice', 'music', 'sfx', 'story', 'screenplay', 'shot_list')),
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled', 'dead_letter')),
  CHECK (retry_count <= max_retries)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| idempotency_key | VARCHAR(255) | NO | - | Unique key to prevent duplicate submissions |
| account_id | UUID | NO | - | Account owning this job |
| project_id | UUID | NO | - | Foreign key to projects |
| job_type | VARCHAR(50) | NO | - | Type of generation (see enum) |
| reference_type | VARCHAR(50) | YES | NULL | Type of referenced entity |
| reference_id | UUID | YES | NULL | ID of referenced entity (shot, episode, etc.) |
| provider | VARCHAR(50) | YES | NULL | Provider used (kling, elevenlabs, suno, etc.) |
| provider_job_id | VARCHAR(255) | YES | NULL | External provider's job ID |
| status | VARCHAR(50) | NO | 'queued' | Job status (see enum) |
| priority | INTEGER | NO | 0 | Higher = more urgent |
| input_data | JSONB | NO | - | Job input parameters |
| output_data | JSONB | YES | NULL | Job results |
| error_message | TEXT | YES | NULL | Human-readable error |
| error_code | VARCHAR(100) | YES | NULL | Machine-readable error code |
| retry_count | INTEGER | NO | 0 | Current retry attempt |
| max_retries | INTEGER | NO | 3 | Maximum retry attempts |
| next_retry_at | TIMESTAMPTZ | YES | NULL | When to retry (exponential backoff) |
| timeout_seconds | INTEGER | NO | 300 | Job timeout (5 minutes default) |
| cost_cents | INTEGER | YES | NULL | Actual cost paid |
| estimated_cost_cents | INTEGER | YES | NULL | Pre-generation estimate |
| started_at | TIMESTAMPTZ | YES | NULL | When job started processing |
| completed_at | TIMESTAMPTZ | YES | NULL | When job completed/failed |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Job Type Enum Values
- `video` - Video generation (Kling, Runway, Hailuo)
- `voice` - Voice/dialogue generation (ElevenLabs, PlayHT)
- `music` - Music generation (Suno)
- `sfx` - Sound effects generation
- `story` - Story generation (LLM)
- `screenplay` - Screenplay conversion (LLM)
- `shot_list` - Shot list generation (LLM)

### Status Enum Values
- `queued` - Waiting to be processed
- `processing` - Currently running
- `completed` - Successfully completed
- `failed` - Failed but can retry
- `cancelled` - User cancelled
- `dead_letter` - Exceeded max retries, moved to DLQ

### Indexes
```sql
CREATE INDEX idx_generation_jobs_project_id ON generation_jobs(project_id);
CREATE INDEX idx_generation_jobs_account_id ON generation_jobs(account_id);
CREATE INDEX idx_generation_jobs_status ON generation_jobs(status);
CREATE INDEX idx_generation_jobs_provider_job_id ON generation_jobs(provider_job_id)
  WHERE provider_job_id IS NOT NULL;
CREATE INDEX idx_generation_jobs_next_retry ON generation_jobs(next_retry_at)
  WHERE next_retry_at IS NOT NULL AND status = 'failed';
CREATE INDEX idx_generation_jobs_reference ON generation_jobs(reference_type, reference_id)
  WHERE reference_type IS NOT NULL;
CREATE INDEX idx_generation_jobs_job_type_status ON generation_jobs(job_type, status);
```

### Constraints
- **Primary Key**: `id`
- **Unique**: `idempotency_key`
- **Foreign Key**: `project_id` references `projects(id)` ON DELETE CASCADE
- **Check Constraints**:
  - `job_type` in enum values
  - `status` in enum values
  - `retry_count` <= `max_retries`

### JSONB Schema

```typescript
// Video job input
interface VideoJobInput {
  prompt: string;
  duration: number;
  aspectRatio?: string;
  negativePrompt?: string;
  seed?: number;
}

// Video job output
interface VideoJobOutput {
  videoUrl: string;
  thumbnailUrl?: string;
  duration: number;
  resolution: string;
}

// Voice job input
interface VoiceJobInput {
  text: string;
  voiceId: string;
  settings: {
    stability: number;
    similarityBoost: number;
  };
}

// Voice job output
interface VoiceJobOutput {
  audioUrl: string;
  duration: number;
  characterCount: number;
}
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created with all columns
- [ ] Unique constraint on idempotency_key
- [ ] Foreign key with CASCADE delete
- [ ] Status and job_type enums enforced
- [ ] Retry constraint enforced
- [ ] Indexes for querying by status, provider, retry time
- [ ] Cost tracking columns present

## Test Plan

### Unit Tests
- [ ] Insert job with unique idempotency_key succeeds
- [ ] Insert job with duplicate idempotency_key fails
- [ ] Insert job with invalid status fails
- [ ] Insert job with retry_count > max_retries fails
- [ ] Update status transitions work correctly

### Integration Tests
- [ ] Deleting project cascades to delete jobs
- [ ] Query jobs ready for retry (next_retry_at < NOW)
- [ ] Query failed jobs for DLQ (retry_count >= max_retries)
- [ ] Exponential backoff calculation

### Retry Logic Test
```sql
-- Simulate retry with exponential backoff
UPDATE generation_jobs
SET
  retry_count = retry_count + 1,
  status = 'failed',
  next_retry_at = NOW() + (POWER(2, retry_count) || ' seconds')::INTERVAL,
  error_message = 'Provider timeout'
WHERE id = 'test-job-id';

-- Move to dead letter queue
UPDATE generation_jobs
SET status = 'dead_letter'
WHERE retry_count >= max_retries AND status = 'failed';
```
