/**
 * This file is used to register monitoring instrumentation
 * for your Next.js application.
 */
import { type Instrumentation } from 'next';

export async function register() {
  const { registerMonitoringInstrumentation } = await import(
    '@kit/monitoring/instrumentation'
  );

  // Register monitoring instrumentation
  // based on the MONITORING_PROVIDER environment variable.
  await registerMonitoringInstrumentation();

  // Initialize local jobs system (cron + workers)
  // Only runs on server-side Node.js runtime
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startCronJobs, startWorkers, isRedisAvailable } = await import(
      '@kit/jobs'
    );

    // Start cron jobs (always available)
    if (process.env.ENABLE_LOCAL_CRON === 'true') {
      console.log('[Instrumentation] Starting cron jobs...');
      startCronJobs();
    }

    // Start workers (only if Redis is available)
    if (process.env.ENABLE_LOCAL_WORKERS === 'true') {
      const redisAvailable = await isRedisAvailable();
      if (redisAvailable) {
        console.log('[Instrumentation] Starting job workers...');
        await startWorkers();
      } else {
        console.log('[Instrumentation] Redis not available, skipping workers');
      }
    }
  }
}

/**
 * @name onRequestError
 * @description This function is called when an error occurs during the request lifecycle.
 * It is used to capture the error and send it to the monitoring service.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context,
) => {
  const { getServerMonitoringService } = await import('@kit/monitoring/server');

  const service = await getServerMonitoringService();

  await service.ready();

  await service.captureException(
    err as Error,
    {},
    {
      path: request.path,
      headers: request.headers,
      method: request.method,
      routePath: context.routePath,
    },
  );
};
