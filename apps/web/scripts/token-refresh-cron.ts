#!/usr/bin/env tsx
/**
 * Local Token Refresh Cron Script
 *
 * Runs during development to keep OAuth tokens refreshed.
 * Calls the /api/cron/refresh-tokens endpoint every 30 minutes.
 *
 * Usage: pnpm run dev:cron
 */
// Named and constructed, not a default import called as a function. croner 9
// is ESM (`export { Cron, CronDate, CronPattern, scheduledJobs }`) with no
// default, so `import Cron from 'croner'` resolved to undefined and the call
// below threw on every start. Invisible until apps/web/scripts came inside
// the tsconfig include.
import { Cron } from 'croner';

const CRON_SECRET = process.env.CRON_SECRET || 'dev-secret';
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.NEXT_PUBLIC_SITE_URL ||
  'http://localhost:3000';

async function refreshTokens() {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] 🔄 Running token refresh...`);

  try {
    const response = await fetch(`${APP_URL}/api/cron/refresh-tokens`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CRON_SECRET}`,
      },
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`[${timestamp}] ✅ Token refresh completed:`, data);
    } else {
      console.error(`[${timestamp}] ❌ Token refresh failed:`, data);
    }
  } catch (error) {
    console.error(`[${timestamp}] ❌ Token refresh error:`, error);
  }
}

// Run immediately on start
console.log('🚀 Token refresh cron started');
console.log(`   APP_URL: ${APP_URL}`);
console.log(`   Schedule: Every 30 minutes`);
console.log('');

// Initial run after 10 seconds (give dev server time to start)
setTimeout(() => {
  refreshTokens();
}, 10000);

// Schedule to run every 30 minutes
const job = new Cron('*/30 * * * *', () => {
  refreshTokens();
});

console.log(`📅 Next run: ${job.nextRun()?.toISOString()}`);

// Keep the process running
process.on('SIGINT', () => {
  console.log('\n👋 Token refresh cron stopped');
  job.stop();
  process.exit(0);
});
