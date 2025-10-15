import { NextResponse } from 'next/server';

import { createCacheClient } from '@kit/cache';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Health Check Endpoint
 *
 * Returns the health status of critical application dependencies:
 * - Database connection
 * - Cache connection
 * - Parameter Store connection (for secret management)
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
    parameterStore: false,
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

    // Check Parameter Store connection (if AWS deployment)
    try {
      // Only check Parameter Store if AWS_REGION is set (indicates AWS deployment)
      if (process.env.AWS_REGION) {
        const { SSMClient, GetParameterCommand } = await import(
          '@aws-sdk/client-ssm'
        );

        const client = new SSMClient({
          region: process.env.AWS_REGION,
        });

        // Try to fetch a health check parameter (non-critical, just tests connectivity)
        // This parameter doesn't need to exist - we just check if AWS API is reachable
        const command = new GetParameterCommand({
          Name: '/healthcheck',
        });

        try {
          await client.send(command);
          checks.parameterStore = true;
        } catch (error) {
          // ParameterNotFound is acceptable - we're just testing connectivity
          // @ts-expect-error - AWS SDK error types
          if (error?.name === 'ParameterNotFound') {
            checks.parameterStore = true;
          } else {
            throw error;
          }
        }
      } else {
        // Not an AWS deployment, skip Parameter Store check
        checks.parameterStore = true;
      }
    } catch (error) {
      console.error('[HealthCheck] Parameter Store check failed:', error);
      checks.parameterStore = false;
    }

    // Determine overall health status
    const isHealthy = checks.database && checks.cache && checks.parameterStore;

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
