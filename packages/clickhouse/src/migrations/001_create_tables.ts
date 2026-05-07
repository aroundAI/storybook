/**
 * ClickHouse DDL Migration Script
 *
 * Creates the video_metrics table and video_daily_stats materialized view.
 * Uses CREATE TABLE IF NOT EXISTS / CREATE MATERIALIZED VIEW IF NOT EXISTS
 * so re-running this migration is safe and will never drop or overwrite data.
 *
 * Usage:
 *   npx tsx packages/clickhouse/src/migrations/001_create_tables.ts
 */

import { getClickHouseClient, closeClickHouseClient } from '../client';

const MIGRATION_TABLE = `
CREATE TABLE IF NOT EXISTS _migrations (
    name String,
    applied_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY name
`;

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

const MIGRATION_NAME = '001_create_tables';

async function runMigrations() {
    console.log('🚀 Running ClickHouse migrations...\n');

    const client = getClickHouseClient();

    try {
        // Ensure migration tracking table exists
        await client.command({ query: MIGRATION_TABLE });

        // Check if this migration was already applied
        const result = await client.query({
            query: `SELECT name FROM _migrations WHERE name = '${MIGRATION_NAME}' LIMIT 1`,
            format: 'JSONEachRow',
        });
        const rows = await result.json<{ name: string }>();

        if (rows.length > 0) {
            console.log(`  ⏭️  Migration ${MIGRATION_NAME} already applied — skipping.`);
            console.log('\n✅ Nothing to do.');
            return;
        }

        console.log('  Creating video_metrics table...');
        await client.command({ query: CREATE_VIDEO_METRICS });
        console.log('  ✅ video_metrics created\n');

        console.log('  Creating video_daily_stats materialized view...');
        await client.command({ query: CREATE_VIDEO_DAILY_STATS });
        console.log('  ✅ video_daily_stats created\n');

        // Record that this migration was applied
        await client.insert({
            table: '_migrations',
            values: [{ name: MIGRATION_NAME }],
            format: 'JSONEachRow',
        });
        console.log(`  📝 Recorded migration: ${MIGRATION_NAME}`);

        // Verify tables exist
        const tables = await client.query({
            query: 'SHOW TABLES',
            format: 'JSONEachRow',
        });
        const tableList = await tables.json<{ name: string }>();
        console.log(
            '  📋 Tables:',
            tableList.map((t) => t.name).join(', '),
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
