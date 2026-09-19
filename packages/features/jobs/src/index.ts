/**
 * Jobs Package
 *
 * Provides local job queue (BullMQ) and cron scheduling (node-cron)
 * for running background tasks without external cloud services.
 */

// Queue exports
export {
  getRedisConnection,
  isRedisAvailable,
  closeRedisConnection,
} from './queues/connection';

export {
  createQueue,
  getQueue,
  QueueName,
  type JobData,
  type JobResult,
} from './queues/definitions';

// Cron exports
export { startCronJobs, stopCronJobs, getCronStatus } from './cron/scheduler';

// Worker exports
export { startWorkers, stopWorkers, getWorkerStatus } from './workers/manager';
