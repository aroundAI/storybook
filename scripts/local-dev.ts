
import { spawn, execSync } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { Redis } from 'ioredis';

// Force local configuration (Highest Priority)
process.env.STORAGE_PROVIDER = 'local';
process.env.ENABLE_FILE_LOGGING = 'true';
process.env.ENABLE_LOCAL_WORKERS = 'true';
process.env.NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNTS = 'false';

// Load environment variables in priority order (first match wins)
// 1. .env.local (Secrets & Local Overrides)
dotenv.config({ path: path.resolve(process.cwd(), 'apps/web/.env.local') });

// 2. .env.development (Dev Defaults)
dotenv.config({ path: path.resolve(process.cwd(), 'apps/web/.env.development') });

// 3. .env (Shared Defaults)
dotenv.config({ path: path.resolve(process.cwd(), 'apps/web/.env') });

// Redis Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

async function checkRedis(): Promise<boolean> {
    const redis = new Redis({
        host: REDIS_HOST,
        port: REDIS_PORT,
        lazyConnect: true,
        connectTimeout: 2000,
        maxRetriesPerRequest: 1
    });

    try {
        await redis.connect();
        await redis.ping();
        await redis.quit();
        return true;
    } catch (error) {
        return false;
    }
}

async function startRedis() {
    console.log('\x1b[33m%s\x1b[0m', '🔄 Connecting to Redis...');

    const isRunning = await checkRedis();
    if (isRunning) {
        console.log('\x1b[32m%s\x1b[0m', '✅ Redis is already running.');
        return;
    }

    console.log('\x1b[33m%s\x1b[0m', '⚠️  Redis not reachable. Attempting to start via Docker...');
    try {
        execSync('docker compose up -d redis', { stdio: 'inherit' });

        // Wait for it to become available
        let attempts = 0;
        while (attempts < 10) {
            await new Promise(r => setTimeout(r, 1000));
            if (await checkRedis()) {
                console.log('\x1b[32m%s\x1b[0m', '✅ Redis started successfully.');
                return;
            }
            attempts++;
        }
        throw new Error('Redis failed to start after timeout');
    } catch (error) {
        console.error('\x1b[31m%s\x1b[0m', '❌ Failed to start Redis. Please run "docker compose up -d redis" manually.');
        process.exit(1);
    }
}

async function main() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting Unified Local Development Environment...');

    // 1. Check/Start Redis
    await startRedis();

    console.log('\x1b[33m%s\x1b[0m', '📝 Configuration:');
    console.log(`   - Storage: Local (${process.env.STORAGE_LOCAL_PATH || 'default'})`);
    console.log(`   - Logging: Stdout + File (${process.env.STORAGE_LOCAL_PATH ? path.join(process.env.STORAGE_LOCAL_PATH, 'logs/app.log') : './logs/app.log'})`);
    console.log(`   - Scheduler: Active`);
    console.log(`   - Workers: Active (via Next.js Instrumentation)`);

    // Import jobs now that env is set
    const { processScheduledPublishes } = await import('@kit/publishing/jobs');
    const { refreshExpiringTokens } = await import('@kit/publishing/jobs');

    // 2. Start Next.js Dev Server
    console.log('\x1b[32m%s\x1b[0m', '\n🌐 Starting Next.js Dev Server...');
    console.log('\x1b[90m%s\x1b[0m', '(Workers will be started automatically by Next.js instrumentation)');

    const nextDev = spawn('pnpm', ['dev'], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env }
    });

    nextDev.on('error', (err) => {
        console.error('Failed to start next dev:', err);
    });

    // 3. Start Local Scheduler Loop
    console.log('\x1b[35m%s\x1b[0m', '\n⏰ Starting Background Scheduler...\n');

    // Helper to run job with logging
    const runJob = async (name: string, fn: () => Promise<any>) => {
        try {
            // console.log(`[Scheduler] Running ${name}...`);
            await fn();
        } catch (error) {
            console.error(`[Scheduler] ❌ ${name} failed:`, error);
        }
    };

    // Initial Run
    runJob('Scheduled Publishes', processScheduledPublishes);
    runJob('Token Refresh', refreshExpiringTokens);

    // Schedule Intervals

    // Every 60 seconds: Publish Scheduled Content
    setInterval(() => {
        runJob('Scheduled Publishes', processScheduledPublishes);
    }, 60 * 1000);

    // Every 30 minutes: Refresh Tokens
    setInterval(() => {
        runJob('Token Refresh', refreshExpiringTokens);
    }, 30 * 60 * 1000);

    // Handle shutdown
    const cleanup = () => {
        console.log('\n🛑 Shutting down services...');
        nextDev.kill();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

main().catch((err) => {
    console.error('Fatal error in dev-runner:', err);
    process.exit(1);
});
