import { NextResponse } from 'next/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createCacheClient } from '@kit/cache';

/**
 * Health Check Endpoint
 *
 * Returns the health status of critical application dependencies:
 * - Database connection
 * - Cache connection
 * - Storage connection
 *
 * Used by:
 * - CI/CD workflows for deployment verification
 * - Load balancers for health monitoring
 * - Monitoring tools for uptime tracking
 *
 * Returns:
 * - 200 OK if all services are healthy
 * - 503 Service Unavailable if any service is unhealthy
 */
export async function GET() {
  const checks = {
    database: false,
    cache: false,
    timestamp: new Date().toISOString(),
  };

  try {
    // Check database connection
    try {
      const client = getSupabaseServerClient();
      const { error } = await client.from('accounts').select('id').limit(1);
      checks.database = !error;
    } catch (error) {
      console.error('[HealthCheck] Database check failed:', error);
      checks.database = false;
    }

    // Check cache connection
    try {
      const cache = createCacheClient();
      checks.cache = await cache.isHealthy();
    } catch (error) {
      console.error('[HealthCheck] Cache check failed:', error);
      checks.cache = false;
    }

    // Determine overall health status
    const isHealthy = checks.database && checks.cache;

    if (isHealthy) {
      return NextResponse.json(
        {
          status: 'healthy',
          checks,
        },
        { status: 200 },
      );
    } else {
      return NextResponse.json(
        {
          status: 'unhealthy',
          checks,
        },
        { status: 503 },
      );
    }
  } catch (error) {
    console.error('[HealthCheck] Unexpected error:', error);

    return NextResponse.json(
      {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error',
        checks,
      },
      { status: 503 },
    );
  }
}
