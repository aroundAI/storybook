'use client';

import { Users } from 'lucide-react';

import { formatPercent } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface GenderData {
  male: number;
  female: number;
  other?: number;
}

interface GenderCardProps {
  /** Gender distribution percentages */
  genders: GenderData;
}

export function GenderCard({ genders }: GenderCardProps) {
  return (
    <AnalyticsCard
      title="Gender"
      icon={Users}
      description="Viewer gender distribution"
      footer="Based on platform demographics data"
    >
      <div className="flex flex-1 flex-col justify-center gap-4">
        {/* Male */}
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-gray-900 dark:text-white">
              Male
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {formatPercent(genders.male)}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className="h-3 rounded-full bg-blue-500"
              style={{ width: `${genders.male}%` }}
            />
          </div>
        </div>
        {/* Female */}
        <div>
          <div className="mb-1 flex justify-between text-xs">
            <span className="font-medium text-gray-900 dark:text-white">
              Female
            </span>
            <span className="text-gray-500 dark:text-gray-400">
              {formatPercent(genders.female)}
            </span>
          </div>
          <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-700">
            <div
              className="h-3 rounded-full bg-pink-500"
              style={{ width: `${genders.female}%` }}
            />
          </div>
        </div>
        {/* Other (if present) */}
        {genders.other !== undefined && genders.other > 0 && (
          <div>
            <div className="mb-1 flex justify-between text-xs">
              <span className="font-medium text-gray-900 dark:text-white">
                Other
              </span>
              <span className="text-gray-500 dark:text-gray-400">
                {formatPercent(genders.other)}
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-700">
              <div
                className="h-3 rounded-full bg-purple-500"
                style={{ width: `${genders.other}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </AnalyticsCard>
  );
}
