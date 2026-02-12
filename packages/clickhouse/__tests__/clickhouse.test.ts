import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the @clickhouse/client module before importing our code
vi.mock('@clickhouse/client', () => ({
    createClient: vi.fn(() => mockClickHouseClient),
}));

const mockQueryResult = {
    json: vi.fn(),
};

const mockClickHouseClient = {
    insert: vi.fn(),
    query: vi.fn(() => Promise.resolve(mockQueryResult)),
    ping: vi.fn(() => Promise.resolve({ success: true })),
    close: vi.fn(),
    command: vi.fn(),
};

describe('@kit/clickhouse', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();

        // Set up required env vars
        process.env.CLICKHOUSE_HOST = 'http://localhost:8123';
        process.env.CLICKHOUSE_USER = 'default';
        process.env.CLICKHOUSE_PASSWORD = '';
        process.env.CLICKHOUSE_DB = 'test_db';
        process.env.CLICKHOUSE_ENABLED = 'true';
    });

    afterEach(() => {
        delete process.env.CLICKHOUSE_HOST;
        delete process.env.CLICKHOUSE_USER;
        delete process.env.CLICKHOUSE_PASSWORD;
        delete process.env.CLICKHOUSE_DB;
        delete process.env.CLICKHOUSE_ENABLED;
    });

    describe('client', () => {
        it('should return singleton instance', async () => {
            const { getClickHouseClient } = await import('../src/client');
            const client1 = getClickHouseClient();
            const client2 = getClickHouseClient();
            expect(client1).toBe(client2);
        });

        it('should throw when CLICKHOUSE_HOST is missing', async () => {
            delete process.env.CLICKHOUSE_HOST;
            const { getClickHouseClient } = await import('../src/client');
            expect(() => getClickHouseClient()).toThrow(
                'Missing required environment variable: CLICKHOUSE_HOST',
            );
        });

        it('should report enabled when env flag is set', async () => {
            const { isClickHouseEnabled } = await import('../src/client');
            expect(isClickHouseEnabled()).toBe(true);
        });

        it('should report disabled when env flag is not set', async () => {
            delete process.env.CLICKHOUSE_ENABLED;
            const { isClickHouseEnabled } = await import('../src/client');
            expect(isClickHouseEnabled()).toBe(false);
        });

        it('should ping successfully', async () => {
            const { pingClickHouse } = await import('../src/client');
            const result = await pingClickHouse();
            expect(result).toBe(true);
        });

        it('should close client and reset singleton', async () => {
            const { getClickHouseClient, closeClickHouseClient } = await import(
                '../src/client'
            );
            getClickHouseClient(); // Create instance
            await closeClickHouseClient();
            expect(mockClickHouseClient.close).toHaveBeenCalled();
        });
    });

    describe('queries', () => {
        describe('insertVideoMetrics', () => {
            it('should insert metrics in JSONEachRow format', async () => {
                const { insertVideoMetrics } = await import('../src/queries');

                const metrics = [
                    {
                        project_id: '550e8400-e29b-41d4-a716-446655440000',
                        video_id: 'vid-1',
                        platform: 'youtube' as const,
                        metric_date: '2026-01-15',
                        views: 1000,
                        likes: 50,
                        comments: 10,
                        shares: 5,
                        saves: 0,
                        watch_time_seconds: 3600,
                        revenue_cents: 250,
                        subscribers_gained: 3,
                        extra_metrics: '{}',
                    },
                ];

                await insertVideoMetrics(metrics);

                expect(mockClickHouseClient.insert).toHaveBeenCalledWith({
                    table: 'video_metrics',
                    values: metrics,
                    format: 'JSONEachRow',
                });
            });

            it('should skip insert when array is empty', async () => {
                const { insertVideoMetrics } = await import('../src/queries');
                await insertVideoMetrics([]);
                expect(mockClickHouseClient.insert).not.toHaveBeenCalled();
            });
        });

        describe('queryTotals', () => {
            it('should return aggregated totals', async () => {
                mockQueryResult.json.mockResolvedValue([
                    {
                        views: '5000',
                        likes: '200',
                        comments: '50',
                        shares: '30',
                        saves: '10',
                        watch_time_seconds: '18000',
                        revenue_cents: '1500',
                        subscribers_gained: '15',
                    },
                ]);

                const { queryTotals } = await import('../src/queries');

                const result = await queryTotals({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                });

                expect(result).toEqual({
                    views: 5000,
                    likes: 200,
                    comments: 50,
                    shares: 30,
                    saves: 10,
                    watch_time_seconds: 18000,
                    revenue_cents: 1500,
                    subscribers_gained: 15,
                });
            });

            it('should return zeros when no data', async () => {
                mockQueryResult.json.mockResolvedValue([]);

                const { queryTotals } = await import('../src/queries');

                const result = await queryTotals({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                });

                expect(result.views).toBe(0);
                expect(result.revenue_cents).toBe(0);
            });

            it('should include date range filters in query', async () => {
                mockQueryResult.json.mockResolvedValue([
                    {
                        views: '100',
                        likes: '10',
                        comments: '5',
                        shares: '2',
                        saves: '1',
                        watch_time_seconds: '600',
                        revenue_cents: '50',
                        subscribers_gained: '1',
                    },
                ]);

                const { queryTotals } = await import('../src/queries');

                await queryTotals({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                    startDate: '2026-01-01',
                    endDate: '2026-01-31',
                });

                const queryCall = mockClickHouseClient.query.mock.calls[0]?.[0];
                expect(queryCall?.query).toContain('metric_date >= {startDate: Date}');
                expect(queryCall?.query).toContain('metric_date <= {endDate: Date}');
                expect(queryCall?.query_params.startDate).toBe('2026-01-01');
                expect(queryCall?.query_params.endDate).toBe('2026-01-31');
            });
        });

        describe('queryDailyTimeSeries', () => {
            it('should return sorted daily data points', async () => {
                mockQueryResult.json.mockResolvedValue([
                    {
                        date: '2026-01-14',
                        views: '400',
                        likes: '20',
                        comments: '5',
                        shares: '3',
                        saves: '1',
                        watch_time_seconds: '2400',
                        revenue_cents: '100',
                    },
                    {
                        date: '2026-01-15',
                        views: '600',
                        likes: '30',
                        comments: '8',
                        shares: '5',
                        saves: '2',
                        watch_time_seconds: '3600',
                        revenue_cents: '150',
                    },
                ]);

                const { queryDailyTimeSeries } = await import('../src/queries');

                const result = await queryDailyTimeSeries({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                });

                expect(result).toHaveLength(2);
                expect(result[0]!.date).toBe('2026-01-14');
                expect(result[0]!.views).toBe(400);
                expect(result[1]!.views).toBe(600);
            });
        });

        describe('queryPlatformBreakdown', () => {
            it('should return per-platform metrics', async () => {
                mockQueryResult.json.mockResolvedValue([
                    {
                        platform: 'youtube',
                        views: '3000',
                        likes: '150',
                        comments: '30',
                        shares: '20',
                        saves: '5',
                        revenue_cents: '1000',
                    },
                    {
                        platform: 'tiktok',
                        views: '2000',
                        likes: '100',
                        comments: '20',
                        shares: '50',
                        saves: '10',
                        revenue_cents: '200',
                    },
                ]);

                const { queryPlatformBreakdown } = await import('../src/queries');

                const result = await queryPlatformBreakdown({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                });

                expect(result).toHaveLength(2);
                expect(result[0]!.platform).toBe('youtube');
                expect(result[0]!.views).toBe(3000);
                expect(result[1]!.platform).toBe('tiktok');
            });
        });

        describe('queryPerVideoTotals', () => {
            it('should return a Map of video_id to totals', async () => {
                mockQueryResult.json.mockResolvedValue([
                    {
                        video_id: 'vid-1',
                        views: '1000',
                        likes: '50',
                        comments: '10',
                        shares: '5',
                        saves: '2',
                        watch_time_seconds: '3600',
                        revenue_cents: '250',
                        subscribers_gained: '3',
                    },
                    {
                        video_id: 'vid-2',
                        views: '2000',
                        likes: '80',
                        comments: '15',
                        shares: '10',
                        saves: '5',
                        watch_time_seconds: '7200',
                        revenue_cents: '500',
                        subscribers_gained: '5',
                    },
                ]);

                const { queryPerVideoTotals } = await import('../src/queries');

                const result = await queryPerVideoTotals({
                    projectId: '550e8400-e29b-41d4-a716-446655440000',
                    videoIds: ['vid-1', 'vid-2'],
                });

                expect(result.size).toBe(2);
                expect(result.get('vid-1')!.views).toBe(1000);
                expect(result.get('vid-2')!.views).toBe(2000);
            });
        });

        describe('queryViewsForVideos', () => {
            it('should return total views for given video IDs', async () => {
                mockQueryResult.json.mockResolvedValue([{ total_views: '5000' }]);

                const { queryViewsForVideos } = await import('../src/queries');

                const views = await queryViewsForVideos(
                    '550e8400-e29b-41d4-a716-446655440000',
                    ['vid-1', 'vid-2'],
                );

                expect(views).toBe(5000);
            });

            it('should return 0 for empty video IDs array', async () => {
                const { queryViewsForVideos } = await import('../src/queries');

                const views = await queryViewsForVideos(
                    '550e8400-e29b-41d4-a716-446655440000',
                    [],
                );

                expect(views).toBe(0);
                expect(mockClickHouseClient.query).not.toHaveBeenCalled();
            });
        });
    });
});
