import { endOfMonth, startOfMonth, subDays, subMonths } from 'date-fns';

import type { DatePreset } from './report-types';

/**
 * The range a report covers for a preset, counted back from now. Lives here
 * and not in `server/report-actions.ts`, a `'use server'` module, which can
 * export only async functions.
 */
export function calculateDateRange(preset: DatePreset): {
  start: Date;
  end: Date;
} {
  const now = new Date();

  switch (preset) {
    case 'last7days':
      return { start: subDays(now, 7), end: now };
    case 'last30days':
      return { start: subDays(now, 30), end: now };
    case 'lastMonth': {
      const lastMonth = subMonths(now, 1);
      return { start: startOfMonth(lastMonth), end: endOfMonth(lastMonth) };
    }
    case 'lastQuarter':
      return { start: subMonths(now, 3), end: now };
    case 'custom':
    default:
      return { start: subDays(now, 30), end: now };
  }
}
