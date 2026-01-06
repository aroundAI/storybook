
import { spawn, execSync, ChildProcess } from 'child_process';
import dotenv from 'dotenv';
import path from 'path';
import { Redis } from 'ioredis';

// Load consolidated environment variables
// This file is manually generated to ensure a single source of truth for the local runner
const envPath = path.resolve(process.cwd(), 'apps/web/.env.localprod');
console.log('\x1b[36m%s\x1b[0m', `📝 Loading environment from: ${envPath}`);
dotenv.config({ path: envPath });

// Redis Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

// Tunnel Configuration
const ENABLE_TUNNEL = process.env.ENABLE_TUNNEL !== 'false'; // Enable by default

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

/**
 * Start a tunnel to expose localhost for external platforms (Instagram, Facebook, TikTok)
 * Uses cloudflared (free, no signup) with fallback to localtunnel
 */
async function startTunnel(): Promise<{ process: ChildProcess; url: string } | null> {
    if (!ENABLE_TUNNEL) {
        console.log('\x1b[90m%s\x1b[0m', '🔧 Tunnel disabled (ENABLE_TUNNEL=false)');
        return null;
    }

    // Check if TUNNEL_URL is already set (manual override)
    if (process.env.TUNNEL_URL) {
        console.log('\x1b[32m%s\x1b[0m', `🌐 Using existing TUNNEL_URL: ${process.env.TUNNEL_URL}`);
        return null;
    }

    console.log('\x1b[33m%s\x1b[0m', '🔧 Starting tunnel for external platform uploads...');

    // Try cloudflared first (more reliable)
    try {
        const tunnelProcess = spawn('cloudflared', ['tunnel', '--url', 'http://localhost:3000'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return new Promise((resolve) => {
            let output = '';

            const handleOutput = (data: Buffer) => {
                output += data.toString();
                // Cloudflared outputs the URL to stderr
                const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
                if (match) {
                    const url = match[0];
                    console.log('\x1b[32m%s\x1b[0m', `✅ Cloudflare tunnel: ${url}`);
                    resolve({ process: tunnelProcess, url });
                }
            };

            tunnelProcess.stdout?.on('data', handleOutput);
            tunnelProcess.stderr?.on('data', handleOutput);

            tunnelProcess.on('error', () => {
                console.log('\x1b[90m%s\x1b[0m', '   cloudflared not found, trying localtunnel...');
                resolve(null);
            });

            // Timeout after 10 seconds
            setTimeout(() => {
                if (!output.includes('trycloudflare.com')) {
                    tunnelProcess.kill();
                    resolve(null);
                }
            }, 10000);
        });
    } catch {
        // cloudflared not available, try localtunnel
    }

    // Fallback to localtunnel
    try {
        const tunnelProcess = spawn('npx', ['localtunnel', '--port', '3000'], {
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        return new Promise((resolve) => {
            tunnelProcess.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                const match = output.match(/https:\/\/[a-z0-9-]+\.loca\.lt/);
                if (match) {
                    const url = match[0];
                    console.log('\x1b[32m%s\x1b[0m', `✅ Localtunnel: ${url}`);
                    resolve({ process: tunnelProcess, url });
                }
            });

            tunnelProcess.on('error', () => {
                console.log('\x1b[33m%s\x1b[0m', '⚠️  No tunnel available. Instagram/Facebook uploads may fail in dev.');
                resolve(null);
            });

            // Timeout after 15 seconds
            setTimeout(() => resolve(null), 15000);
        });
    } catch {
        console.log('\x1b[33m%s\x1b[0m', '⚠️  No tunnel available. Set TUNNEL_URL manually or install cloudflared.');
        return null;
    }
}

async function main() {
    console.log('\x1b[36m%s\x1b[0m', '🚀 Starting Unified Local Development Environment...');

    // 1. Check/Start Redis
    await startRedis();

    // 2. Start tunnel for external platforms
    const tunnel = await startTunnel();
    if (tunnel) {
        process.env.TUNNEL_URL = tunnel.url;
    }

    console.log('\x1b[33m%s\x1b[0m', '📝 Configuration:');
    console.log(`   - Storage: Local (${process.env.STORAGE_LOCAL_PATH || 'default'})`);
    console.log(`   - Logging: Stdout + File (${process.env.STORAGE_LOCAL_PATH ? path.join(process.env.STORAGE_LOCAL_PATH, 'logs/app.log') : './logs/app.log'})`);
    console.log(`   - Workers: Active (via Next.js Instrumentation)`);
    console.log(`   - Scheduler: Handled by Workers (BullMQ Repeatable Jobs)`);
    if (tunnel) {
        console.log(`   - Tunnel: ${tunnel.url} (for Instagram/Facebook/TikTok)`);
    }

    // 3. Start Next.js Dev Server with .env.localprod (already loaded by dotenv above)
    console.log('\x1b[32m%s\x1b[0m', '\n🌐 Starting Next.js Dev Server with .env.localprod...');
    console.log('\x1b[90m%s\x1b[0m', '(Workers and scheduled jobs are started automatically by Next.js instrumentation)');

    // Run next dev directly from apps/web directory, passing inherited env vars from dotenv
    const nextDev = spawn('pnpm', ['dev'], {
        stdio: 'inherit',
        cwd: path.resolve(process.cwd(), 'apps/web'),
        env: { ...process.env }
    });

    nextDev.on('error', (err) => {
        console.error('Failed to start next dev:', err);
    });

    // Handle shutdown
    const cleanup = () => {
        console.log('\n🛑 Shutting down services...');
        nextDev.kill();
        tunnel?.process.kill();
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

main().catch((err) => {
    console.error('Fatal error in dev-runner:', err);
    process.exit(1);
});

