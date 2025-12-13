/**
 * Cron Scheduler
 *
 * Manages scheduled jobs using node-cron.
 * Runs tasks at specified intervals when the app is running.
 */

import 'server-only';

import cron, { type ScheduledTask } from 'node-cron';

/**
 * Cron job definition
 */
interface CronJob {
    name: string;
    schedule: string;
    handler: () => Promise<void>;
    enabled: boolean;
}

/**
 * Active cron tasks
 */
const activeTasks = new Map<string, ScheduledTask>();

/**
 * Cron job status
 */
interface CronStatus {
    name: string;
    schedule: string;
    enabled: boolean;
    running: boolean;
    lastRun?: Date;
    nextRun?: Date;
}

const jobStatus = new Map<string, { lastRun?: Date; running: boolean }>();

/**
 * Define all cron jobs
 */
function getCronJobs(): CronJob[] {
    return [
        {
            name: 'analytics-sync',
            schedule: '0 * * * *', // Every hour
            handler: async () => {
                console.log('[Cron] Running analytics sync...');
                // Import dynamically to avoid circular dependencies
                const { runAnalyticsSyncJob } = await import(
                    '@kit/content-analytics/server'
                );
                const result = await runAnalyticsSyncJob();
                console.log(
                    `[Cron] Analytics sync complete: ${result.successful}/${result.totalProcessed}`,
                );
            },
            enabled: true,
        },
        {
            name: 'token-refresh',
            schedule: '*/30 * * * *', // Every 30 minutes
            handler: async () => {
                console.log('[Cron] Refreshing expiring tokens...');
                try {
                    const { refreshExpiringTokens } = await import(
                        '@kit/publishing/jobs'
                    );
                    await refreshExpiringTokens();
                    console.log('[Cron] Token refresh complete');
                } catch (error) {
                    console.warn('[Cron] Token refresh skipped:', error);
                }
            },
            enabled: true,
        },
        {
            name: 'storage-cleanup',
            schedule: '0 3 * * *', // Daily at 3 AM
            handler: async () => {
                console.log('[Cron] Running storage cleanup...');
                // Cleanup old temp files, orphaned uploads, etc.
                // This is a placeholder for future implementation
                console.log('[Cron] Storage cleanup complete');
            },
            enabled: false, // Disabled by default
        },
        {
            name: 'weekly-report',
            schedule: '0 9 * * 1', // Monday at 9 AM
            handler: async () => {
                console.log('[Cron] Generating weekly report...');
                // Generate usage statistics, cost tracking, etc.
                // This is a placeholder for future implementation
                console.log('[Cron] Weekly report complete');
            },
            enabled: false, // Disabled by default
        },
    ];
}

/**
 * Start all enabled cron jobs
 */
export function startCronJobs(): void {
    const jobs = getCronJobs();

    console.log(`[Cron] Starting ${jobs.filter((j) => j.enabled).length} cron jobs...`);

    for (const job of jobs) {
        if (!job.enabled) {
            console.log(`[Cron] Skipping disabled job: ${job.name}`);
            continue;
        }

        if (!cron.validate(job.schedule)) {
            console.error(`[Cron] Invalid schedule for job "${job.name}": ${job.schedule}`);
            continue;
        }

        const task = cron.schedule(
            job.schedule,
            async () => {
                const status = jobStatus.get(job.name) || { running: false };

                if (status.running) {
                    console.warn(`[Cron] Job "${job.name}" is already running, skipping`);
                    return;
                }

                jobStatus.set(job.name, { ...status, running: true });

                try {
                    await job.handler();
                } catch (error) {
                    console.error(`[Cron] Job "${job.name}" failed:`, error);
                } finally {
                    jobStatus.set(job.name, {
                        running: false,
                        lastRun: new Date(),
                    });
                }
            },
            {
                name: job.name,
                timezone: process.env.TZ || 'UTC',
            },
        );

        activeTasks.set(job.name, task);
        jobStatus.set(job.name, { running: false });
        console.log(`[Cron] Started job: ${job.name} (${job.schedule})`);
    }
}

/**
 * Stop all cron jobs
 */
export function stopCronJobs(): void {
    console.log(`[Cron] Stopping ${activeTasks.size} cron jobs...`);

    for (const [name, task] of activeTasks) {
        task.stop();
        console.log(`[Cron] Stopped job: ${name}`);
    }

    activeTasks.clear();
}

/**
 * Get status of all cron jobs
 */
export function getCronStatus(): CronStatus[] {
    const jobs = getCronJobs();

    return jobs.map((job) => {
        const status = jobStatus.get(job.name);
        const _task = activeTasks.get(job.name);

        return {
            name: job.name,
            schedule: job.schedule,
            enabled: job.enabled,
            running: status?.running || false,
            lastRun: status?.lastRun,
            // nextRun would require parsing the cron expression
        };
    });
}

/**
 * Manually trigger a cron job
 */
export async function triggerCronJob(name: string): Promise<boolean> {
    const jobs = getCronJobs();
    const job = jobs.find((j) => j.name === name);

    if (!job) {
        console.warn(`[Cron] Job "${name}" not found`);
        return false;
    }

    console.log(`[Cron] Manually triggering job: ${name}`);

    try {
        await job.handler();
        return true;
    } catch (error) {
        console.error(`[Cron] Manual trigger of "${name}" failed:`, error);
        return false;
    }
}
