'use client';

import { DollarSign } from 'lucide-react';

import { formatCurrency } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface RevenueBreakdown {
  adRevenue: number;
  sponsorships: number;
}

interface RevenueCardProps {
  /** Total revenue in cents */
  revenueCents: number;
  /** Revenue breakdown */
  breakdown?: RevenueBreakdown;
  /** Projection text */
  projection?: string;
}

export function RevenueCard({
  revenueCents,
  breakdown,
  projection,
}: RevenueCardProps) {
  const revenue = revenueCents / 100;

  // Calculate percentages for breakdown
  const total = breakdown
    ? breakdown.adRevenue + breakdown.sponsorships
    : revenueCents / 100;
  const adPercentage = breakdown ? (breakdown.adRevenue / total) * 100 : 70;
  const sponsorPercentage = breakdown
    ? (breakdown.sponsorships / total) * 100
    : 30;

  return (
    <AnalyticsCard
      title="Est. Revenue"
      icon={DollarSign}
      description="Estimated ad revenue (YouTube only)"
      footer={projection || 'Projection: $10k by month end'}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-5xl font-extrabold tracking-tight text-gray-900 dark:text-white">
          {formatCurrency(revenue)}
        </span>
      </div>
      <div className="mt-4 w-full rounded-lg bg-gray-100 p-3 dark:bg-gray-800">
        {/* Ad Revenue */}
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">Ad Revenue</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {formatCurrency(breakdown?.adRevenue || revenue * 0.7)}
          </span>
        </div>
        <div className="mb-2 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-1.5 rounded-full bg-green-500"
            style={{ width: `${adPercentage}%` }}
          />
        </div>
        {/* Sponsorships */}
        <div className="mb-1 flex justify-between text-xs">
          <span className="text-gray-500 dark:text-gray-400">Sponsorships</span>
          <span className="font-medium text-gray-900 dark:text-white">
            {formatCurrency(breakdown?.sponsorships || revenue * 0.3)}
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700">
          <div
            className="h-1.5 rounded-full bg-blue-500"
            style={{ width: `${sponsorPercentage}%` }}
          />
        </div>
      </div>
    </AnalyticsCard>
  );
}
