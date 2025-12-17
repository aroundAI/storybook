'use client';

import { Clock } from 'lucide-react';

import { PeakActivityGrid } from '../charts/heatmap-grid';
import { AudienceCard } from './audience-card';

interface PeakActivityCardProps {
  /** 2D array of activity values (4 time slots x 7 days), values 0-1 */
  activityData?: number[][];
  /** Peak time description */
  peakTime?: string;
  /** Peak time subtitle */
  peakTimeSubtitle?: string;
}

export function PeakActivityCard({
  activityData,
  peakTime = 'Friday, 6:00 PM - 9:00 PM',
  peakTimeSubtitle = 'Most active global time',
}: PeakActivityCardProps) {
  return (
    <AudienceCard
      title="Peak Activity"
      icon={Clock}
      footerInsight="Posting schedule should target Friday evenings to maximize initial velocity."
    >
      <div className="flex flex-1 flex-col items-center justify-center">
        <PeakActivityGrid data={activityData} className="w-full" />
        <div className="mt-4 text-center">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">
            {peakTime}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {peakTimeSubtitle}
          </p>
        </div>
      </div>
    </AudienceCard>
  );
}
