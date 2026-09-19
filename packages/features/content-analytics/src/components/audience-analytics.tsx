'use client';

import { useMemo } from 'react';

import { Globe, Users } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import type { AudienceData } from '../types';

export interface AudienceAnalyticsProps {
  data: AudienceData | undefined;
  isLoading?: boolean;
}

export function AudienceAnalytics({
  data,
  isLoading = false,
}: AudienceAnalyticsProps) {
  const sortedAgeGroups = useMemo(() => {
    if (!data?.demographics?.ageGroups) return [];
    return Object.entries(data.demographics.ageGroups).sort(([a], [b]) =>
      a.localeCompare(b),
    );
  }, [data?.demographics?.ageGroups]);

  const sortedGenders = useMemo(() => {
    if (!data?.demographics?.genders) return [];
    return Object.entries(data.demographics.genders).sort(
      ([, a], [, b]) => b - a,
    );
  }, [data?.demographics?.genders]);

  const sortedGeography = useMemo(() => {
    if (!data?.geography) return [];
    return Object.entries(data.geography)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
  }, [data?.geography]);

  if (isLoading) {
    return <AudienceAnalyticsSkeleton />;
  }

  const hasData =
    data &&
    ((data.demographics?.ageGroups &&
      Object.keys(data.demographics.ageGroups).length > 0) ||
      (data.demographics?.genders &&
        Object.keys(data.demographics.genders).length > 0) ||
      (data.geography && Object.keys(data.geography).length > 0));

  if (!hasData) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
          <h3 className="text-lg font-semibold">No Audience Data Available</h3>
          <p className="mt-2 text-muted-foreground">
            Audience demographics will appear here once your content gets more
            views and the platforms provide demographic data.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {/* Age Distribution */}
      {data.demographics?.ageGroups &&
        Object.keys(data.demographics.ageGroups).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Age Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sortedAgeGroups.map(([ageGroup, percentage]) => (
                  <div key={ageGroup} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{formatAgeGroup(ageGroup)}</span>
                      <span className="text-muted-foreground">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                    <Progress value={percentage} className="h-2" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Gender Distribution */}
      {data.demographics?.genders &&
        Object.keys(data.demographics.genders).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Gender Distribution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {sortedGenders.map(([gender, percentage]) => (
                  <div key={gender} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="capitalize">{gender}</span>
                      <span className="text-muted-foreground">
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                    <Progress
                      value={percentage}
                      className={`h-2 ${getGenderColor(gender)}`}
                    />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      {/* Geographic Distribution */}
      {data.geography && Object.keys(data.geography).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Globe className="h-4 w-4" />
              Top Countries
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {sortedGeography.map(([country, percentage]) => (
                <div key={country} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {getCountryFlag(country)} {country}
                    </span>
                    <span className="text-muted-foreground">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                  <Progress value={percentage} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatAgeGroup(ageGroup: string): string {
  // Handle formats like "age18-24" or "18-24" or "AGE18_24"
  const match = ageGroup.match(/(\d+)[_-]?(\d+)?/);
  if (match) {
    const [, start, end] = match;
    if (end) {
      return `${start}-${end} years`;
    }
    return `${start}+ years`;
  }
  return ageGroup;
}

function getGenderColor(gender: string): string {
  const lower = gender.toLowerCase();
  if (lower === 'male') return '[&>div]:bg-blue-500';
  if (lower === 'female') return '[&>div]:bg-pink-500';
  return '[&>div]:bg-purple-500';
}

function getCountryFlag(country: string): string {
  // Map common country codes/names to flag emojis
  const flagMap: Record<string, string> = {
    US: '🇺🇸',
    USA: '🇺🇸',
    'United States': '🇺🇸',
    GB: '🇬🇧',
    UK: '🇬🇧',
    'United Kingdom': '🇬🇧',
    CA: '🇨🇦',
    Canada: '🇨🇦',
    AU: '🇦🇺',
    Australia: '🇦🇺',
    DE: '🇩🇪',
    Germany: '🇩🇪',
    FR: '🇫🇷',
    France: '🇫🇷',
    JP: '🇯🇵',
    Japan: '🇯🇵',
    IN: '🇮🇳',
    India: '🇮🇳',
    BR: '🇧🇷',
    Brazil: '🇧🇷',
    MX: '🇲🇽',
    Mexico: '🇲🇽',
  };
  return flagMap[country] || '🌍';
}

function AudienceAnalyticsSkeleton() {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                  <Skeleton className="h-2 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
