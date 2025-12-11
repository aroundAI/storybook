import 'server-only';

import type { SyncSchedule } from './types';

/**
 * Determines the sync schedule based on content age.
 *
 * Schedule Rules:
 * - First 24 hours: hourly (content is fresh, metrics change rapidly)
 * - Days 2-7: every 6 hours (still growing)
 * - Days 8-30: daily (stabilizing)
 * - After 90 days: weekly (stable, minimal changes)
 */
export function getSyncSchedule(publishedAt: Date): SyncSchedule {
  const now = new Date();
  const ageMs = now.getTime() - publishedAt.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  const ageDays = ageHours / 24;

  if (ageHours < 24) {
    return {
      frequency: 'hourly',
      nextSyncAt: new Date(now.getTime() + 60 * 60 * 1000),
      ageCategory: 'first_day',
    };
  }

  if (ageDays < 7) {
    return {
      frequency: 'every_6_hours',
      nextSyncAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
      ageCategory: 'first_week',
    };
  }

  if (ageDays < 30) {
    return {
      frequency: 'daily',
      nextSyncAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      ageCategory: 'first_month',
    };
  }

  // After 30 days (spec says 90 for weekly, but we use 30 as cutoff for "first_month")
  return {
    frequency: 'weekly',
    nextSyncAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
    ageCategory: 'after_90_days',
  };
}

/**
 * Determines if a publish should be synced based on its schedule
 */
export function shouldSyncNow(
  publishedAt: Date,
  lastSyncedAt: Date | null,
): boolean {
  const schedule = getSyncSchedule(publishedAt);

  if (!lastSyncedAt) {
    return true; // Never synced, should sync
  }

  const timeSinceLastSync = Date.now() - lastSyncedAt.getTime();
  const hourMs = 60 * 60 * 1000;

  switch (schedule.frequency) {
    case 'hourly':
      return timeSinceLastSync >= hourMs;
    case 'every_6_hours':
      return timeSinceLastSync >= 6 * hourMs;
    case 'daily':
      return timeSinceLastSync >= 24 * hourMs;
    case 'weekly':
      return timeSinceLastSync >= 7 * 24 * hourMs;
    default:
      return true;
  }
}

/**
 * Calculates priority for sync queue (lower = higher priority)
 * Recent content gets higher priority
 */
export function getSyncPriority(publishedAt: Date): number {
  const schedule = getSyncSchedule(publishedAt);

  switch (schedule.ageCategory) {
    case 'first_day':
      return 0;
    case 'first_week':
      return 1;
    case 'first_month':
      return 2;
    case 'after_90_days':
      return 3;
    default:
      return 4;
  }
}

/**
 * Gets the interval in hours for a given frequency
 */
export function getIntervalHours(frequency: SyncSchedule['frequency']): number {
  switch (frequency) {
    case 'hourly':
      return 1;
    case 'every_6_hours':
      return 6;
    case 'daily':
      return 24;
    case 'weekly':
      return 168;
    default:
      return 24;
  }
}
