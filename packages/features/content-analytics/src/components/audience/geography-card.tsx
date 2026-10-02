'use client';

import { useMemo } from 'react';

import { Globe } from 'lucide-react';

import { topRegionClaim } from '../overview/card-claim';
import { AudienceCard, AudienceCardEmpty } from './audience-card';

interface GeographyCardProps {
  /** Percentage of views per country. Absent when none was reported. */
  geography?: Record<string, number>;
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

export function GeographyCard({ geography }: GeographyCardProps) {
  // Sort countries by percentage and take top 7
  const sortedCountries = useMemo(
    () =>
      Object.entries(geography ?? {})
        .map(([country, percentage]) => ({ country, percentage }))
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 7),
    [geography],
  );

  // Find the highest percentage for highlighting
  const maxPercentage = sortedCountries[0]?.percentage || 0;

  if (sortedCountries.length === 0) {
    return (
      <AudienceCard
        title="Top Geographies"
        icon={Globe}
        metricFamily="geography"
        claim={topRegionClaim([])}
        data-test="audience-card-geography"
      >
        <AudienceCardEmpty>
          No platform has reported viewer countries for this project yet.
        </AudienceCardEmpty>
      </AudienceCard>
    );
  }

  return (
    <AudienceCard
      title="Top Geographies"
      icon={Globe}
      metricFamily="geography"
      claim={topRegionClaim(sortedCountries)}
      data-test="audience-card-geography"
    >
      <div className="space-y-4">
        {sortedCountries.map((item) => {
          const isTop = item.percentage === maxPercentage;
          return (
            <div
              key={item.country}
              className="flex items-center gap-3"
              data-test={`geography-row-${item.country}`}
            >
              <div className="w-6 text-xl">{getCountryFlag(item.country)}</div>
              <div className="flex-1">
                <div className="mb-1 flex justify-between text-xs">
                  <span className="font-medium text-gray-900 dark:text-white">
                    {item.country}
                  </span>
                  <span
                    data-test="geography-share"
                    className={
                      isTop
                        ? 'font-semibold text-gray-900 dark:text-white'
                        : 'text-gray-500 dark:text-gray-400'
                    }
                  >
                    {item.percentage.toFixed(1)}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                  <div
                    className={`h-1.5 rounded-full ${
                      isTop ? 'bg-blue-500' : 'bg-gray-400 dark:bg-gray-500'
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </AudienceCard>
  );
}
