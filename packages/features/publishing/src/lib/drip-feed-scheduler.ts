import { addDays, isWeekend, set, isSameDay } from 'date-fns';

export type CadencePreset = 'daily' | '3x-week' | '5x-week' | 'weekly' | 'custom';

export interface DripFeedConfig {
  startDate: Date;
  cadence: CadencePreset;
  customDaysOfWeek?: number[]; // 0=Sun, 1=Mon, ... 6=Sat (for 'custom' cadence)
  preferredTimeOfDay: { hours: number; minutes: number };
  skipWeekends?: boolean;
  avoidDays?: Date[]; // holidays, etc.
}

export interface DripFeedItem {
  episodeId: string;
  title: string;
  scheduledAt: Date;
  index: number;
}

export function getCadenceLabel(cadence: CadencePreset): string {
  const labels: Record<CadencePreset, string> = {
    daily: 'Daily',
    '3x-week': '3x per week (Mon/Wed/Fri)',
    '5x-week': '5x per week (Mon-Fri)',
    weekly: 'Weekly',
    custom: 'Custom',
  };
  return labels[cadence];
}

export function getDefaultDaysForCadence(cadence: CadencePreset): number[] {
  switch (cadence) {
    case 'daily':
      return [0, 1, 2, 3, 4, 5, 6];
    case '3x-week':
      return [1, 3, 5]; // Mon, Wed, Fri
    case '5x-week':
      return [1, 2, 3, 4, 5]; // Mon-Fri
    case 'weekly':
      return [1]; // Default to Monday
    case 'custom':
      return [];
  }
}

function isValidDay(
  date: Date,
  config: DripFeedConfig,
  allowedDays: number[]
): boolean {
  if (config.skipWeekends && isWeekend(date)) {
    return false;
  }
  
  if (!allowedDays.includes(date.getDay())) {
    return false;
  }
  
  if (config.avoidDays?.some(avoidDay => isSameDay(date, avoidDay))) {
    return false;
  }
  
  return true;
}

export function calculateDripFeedSchedule(
  episodes: Array<{ id: string; title: string }>,
  config: DripFeedConfig,
): DripFeedItem[] {
  const schedule: DripFeedItem[] = [];
  let currentDate = set(config.startDate, {
    hours: config.preferredTimeOfDay.hours,
    minutes: config.preferredTimeOfDay.minutes,
    seconds: 0,
    milliseconds: 0,
  });

  const allowedDays = config.cadence === 'custom' && config.customDaysOfWeek
    ? config.customDaysOfWeek
    : getDefaultDaysForCadence(config.cadence);

  for (let i = 0; i < episodes.length; i++) {
    const episode = episodes[i];
    if (!episode) continue;
    
    while (!isValidDay(currentDate, config, allowedDays)) {
      currentDate = addDays(currentDate, 1);
    }
    
    schedule.push({
      episodeId: episode.id,
      title: episode.title,
      scheduledAt: new Date(currentDate), // clone
      index: i,
    });
    
    // advance to next day for the next iteration
    currentDate = addDays(currentDate, 1);
  }

  return schedule;
}
