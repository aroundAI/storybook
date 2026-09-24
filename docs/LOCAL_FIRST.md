# Local-First Architecture Setup

This document explains how to set up the local-first development environment for StoryBook.

## Overview

The local-first architecture allows you to run StoryBook primarily on your local machine, reducing cloud costs during development. It includes:

- **Local Storage** - Files stored on filesystem instead of cloud storage
- **Local Job Queues** - BullMQ + Redis for background jobs
- **Local Cron Jobs** - node-cron for scheduled tasks
- **Local Analytics** - Aggregated dashboards for content performance

## Quick Start

### 1. Start Local Services

```bash
# Start Redis with Docker
docker compose up -d

# Or install Redis directly (macOS)
brew install redis
brew services start redis
```

### 2. Configure Environment

Add to `.env.local`:

```bash
# Storage - local Supabase Storage (the default when STORAGE_PROVIDER is unset).
# STORAGE_PROVIDER accepts only supabase or r2; `local` is refused (KB-70).

# Jobs - Enable local workers and cron
ENABLE_LOCAL_CRON=true
ENABLE_LOCAL_WORKERS=true

# Redis connection
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 3. Start the Application

```bash
pnpm dev
```

## Components

### Local Storage (`@kit/storage`)

> **No longer selectable (KB-70).** `STORAGE_PROVIDER` accepts only `supabase`
> and `r2`, so this adapter cannot be chosen by configuration.

Replaces Supabase Storage with local filesystem storage.

```typescript
import { getStorageAdapter } from '@kit/storage';

const storage = getStorageAdapter(supabaseClient);
await storage.upload('bucket', 'path/file.png', buffer, { contentType: 'image/png' });
```

**Environment Variables:**
- `STORAGE_PROVIDER` - `supabase` (default) or `r2`
- `STORAGE_LOCAL_PATH` - Base directory for local storage

**API Route:**
- `/api/storage/[bucket]/[...path]` - Serves local files

### Job Queues (`@kit/jobs`)

BullMQ-based job queue for background processing.

```typescript
import { addJob, QueueName } from '@kit/jobs';

// Add a job
await addJob(QueueName.VIDEO_GENERATION, {
  shotId: '123',
  episodeId: '456',
  prompt: 'Generate video...',
  provider: 'runway',
});
```

**Available Queues:**
- `video-generation` - Video generation jobs
- `audio-generation` - Voice/music/SFX generation
- `analytics-sync` - Analytics sync jobs
- `image-processing` - Image resizing/optimization

### Cron Scheduler

Runs scheduled tasks using node-cron.

| Job | Schedule | Description |
|-----|----------|-------------|
| analytics-sync | Every hour | Sync platform analytics |
| token-refresh | Every 30 min | Refresh expiring OAuth tokens |

### Analytics Dashboard

Access analytics at:
- `/studio/[project]/analytics` - Project-level analytics
- `/studio/[project]/episodes/[episode]/analytics` - Episode analytics

## Redis Setup

### Option 1: Docker (Recommended)

```bash
# Start Redis
docker compose up -d

# View logs
docker compose logs -f redis

# Stop
docker compose down
```

### Option 2: Homebrew (macOS)

```bash
brew install redis
brew services start redis
redis-cli ping  # Should return PONG
```

### Option 3: Without Redis

If Redis is not available:
- Job queues will be disabled (jobs run synchronously or are skipped)
- Cron jobs will still work (they don't require Redis)
- Set `ENABLE_LOCAL_WORKERS=false` to avoid connection errors

## Switching to Production

To switch back to cloud services:

```bash
# .env.local
STORAGE_PROVIDER=supabase
ENABLE_LOCAL_CRON=false
ENABLE_LOCAL_WORKERS=false
```

The code automatically uses the appropriate provider based on environment variables.

## Troubleshooting

### Redis Connection Failed
```
[Jobs] Redis connection error: connect ECONNREFUSED
```
**Fix:** Start Redis with `docker compose up -d` or `brew services start redis`

### Local Storage 404
```
Local storage is not enabled
```
**Fix:** Ensure `STORAGE_PROVIDER=local` is set in environment

### Cron Jobs Not Running
Enable with `ENABLE_LOCAL_CRON=true` in `.env.local`
