/**
 * ClickHouse DDL Migration Script
 *
 * Creates the video_metrics table and video_daily_stats materialized view.
 * Run this once against your ClickHouse instance to set up the schema.
 *
 * Usage:
 *   npx tsx packages/clickhouse/src/migrations/001_create_tables.ts
 */

import { getClickHouseClient, closeClickHouseClient } from '../client';

const CREATE_VIDEO_METRICS = `
CREATE TABLE IF NOT EXISTS video_metrics (
    project_id UUID,
    video_id String,
    platform Enum('youtube' = 1, 'tiktok' = 2, 'instagram' = 3),
    metric_date Date,
    metric_timestamp DateTime DEFAULT now(),
    views UInt64,
    likes UInt32,
    comments UInt32,
    shares UInt32,
    saves UInt32,
    watch_time_seconds UInt64,
    revenue_cents Int64,
    subscribers_gained Int32,
    extra_metrics String DEFAULT '{}'
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_timestamp)
SETTINGS index_granularity = 8192
`;

const CREATE_VIDEO_DAILY_STATS = `
CREATE MATERIALIZED VIEW IF NOT EXISTS video_daily_stats
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(metric_date)
ORDER BY (project_id, platform, video_id, metric_date)
AS SELECT
    project_id,
    video_id,
    platform,
    metric_date,
    sum(views) AS views,
    sum(likes) AS likes,
    sum(comments) AS comments,
    sum(shares) AS shares,
    sum(saves) AS saves,
    sum(watch_time_seconds) AS watch_time_seconds,
    sum(revenue_cents) AS revenue_cents,
    sum(subscribers_gained) AS subscribers_gained
FROM video_metrics
GROUP BY project_id, video_id, platform, metric_date
`;

async function runMigrations() {
    console.log('🚀 Running ClickHouse migrations...\n');

    const client = getClickHouseClient();

    try {
        console.log('  Creating video_metrics table...');
        await client.command({ query: CREATE_VIDEO_METRICS });
        console.log('  ✅ video_metrics created\n');

        console.log('  Creating video_daily_stats materialized view...');
        await client.command({ query: CREATE_VIDEO_DAILY_STATS });
        console.log('  ✅ video_daily_stats created\n');

        // Verify tables exist
        const result = await client.query({
            query: 'SHOW TABLES',
            format: 'JSONEachRow',
        });
        const tables = await result.json<{ name: string }>();
        console.log(
            '  📋 Tables:',
            tables.map((t) => t.name).join(', '),
        );

        console.log('\n✅ All migrations complete.');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await closeClickHouseClient();
    }
}

// Run if executed directly
runMigrations();
