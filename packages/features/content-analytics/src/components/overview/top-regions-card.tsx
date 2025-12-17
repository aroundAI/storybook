'use client';

import { Globe } from 'lucide-react';

import { formatPercent } from '../../lib/format';
import { AnalyticsCard } from './analytics-card';

interface Region {
  country: string;
  percentage: number;
}

interface TopRegionsCardProps {
  /** Top regions data */
  regions: Region[];
}

const COUNTRY_FLAGS: Record<string, string> = {
  'United States': '🇺🇸',
  US: '🇺🇸',
  USA: '🇺🇸',
  'United Kingdom': '🇬🇧',
  UK: '🇬🇧',
  GB: '🇬🇧',
  Canada: '🇨🇦',
  CA: '🇨🇦',
  Australia: '🇦🇺',
  AU: '🇦🇺',
  Germany: '🇩🇪',
  DE: '🇩🇪',
  France: '🇫🇷',
  FR: '🇫🇷',
  Japan: '🇯🇵',
  JP: '🇯🇵',
  India: '🇮🇳',
  IN: '🇮🇳',
  Brazil: '🇧🇷',
  BR: '🇧🇷',
  Mexico: '🇲🇽',
  MX: '🇲🇽',
  Spain: '🇪🇸',
  ES: '🇪🇸',
  Italy: '🇮🇹',
  IT: '🇮🇹',
  Netherlands: '🇳🇱',
  NL: '🇳🇱',
  'South Korea': '🇰🇷',
  KR: '🇰🇷',
};

function getCountryFlag(country: string): string {
  return COUNTRY_FLAGS[country] || '🌍';
}

export function TopRegionsCard({ regions }: TopRegionsCardProps) {
  const topRegions = regions.slice(0, 3);

  return (
    <AnalyticsCard
      title="Top Regions"
      icon={Globe}
      description="Geographic distribution of viewers"
      footer="Based on platform geography data"
    >
      <div className="flex flex-1 flex-col justify-center space-y-3">
        {topRegions.length > 0 ? (
          topRegions.map((region, index) => (
            <div
              key={index}
              className="flex items-center justify-between text-sm"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{getCountryFlag(region.country)}</span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {region.country}
                </span>
              </div>
              <span className="font-extrabold text-gray-900 dark:text-white">
                {formatPercent(region.percentage)}
              </span>
            </div>
          ))
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No geographic data available yet.
          </p>
        )}
      </div>
    </AnalyticsCard>
  );
}
