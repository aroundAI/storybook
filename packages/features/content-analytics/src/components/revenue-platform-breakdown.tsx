'use client';

import { useMemo } from 'react';

import { Facebook, Instagram, Twitter, Youtube } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Progress } from '@kit/ui/progress';
import { Skeleton } from '@kit/ui/skeleton';

import { DEFAULT_CURRENCY, formatCurrencyAmount } from '../lib/money';

interface RevenuePlatformBreakdownProps {
  breakdown: Record<string, number>;
  /**
   * The total `breakdown` is a share of — the same currency's, never a sum
   * across currencies (KB-12).
   */
  total: number;
  /** The currency of `breakdown` and `total`. */
  currency?: string | null;
  isLoading?: boolean;
}

const WHOLE_UNITS = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

const PLATFORM_CONFIG: Record<
  string,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  youtube: { label: 'YouTube', icon: Youtube, color: 'bg-red-500' },
  tiktok: {
    label: 'TikTok',
    icon: () => (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1.04-.1z" />
      </svg>
    ),
    color: 'bg-black',
  },
  instagram: {
    label: 'Instagram',
    icon: Instagram,
    color: 'bg-gradient-to-r from-purple-500 to-pink-500',
  },
  facebook: { label: 'Facebook', icon: Facebook, color: 'bg-blue-600' },
  twitter: { label: 'Twitter', icon: Twitter, color: 'bg-sky-500' },
  manual: {
    label: 'Manual Entry',
    icon: () => <span className="text-sm">$</span>,
    color: 'bg-gray-500',
  },
};

export function RevenuePlatformBreakdown({
  breakdown,
  total,
  currency = DEFAULT_CURRENCY,
  isLoading,
}: RevenuePlatformBreakdownProps) {
  const platforms = useMemo(() => {
    return Object.entries(breakdown)
      .map(([platform, cents]) => ({
        platform,
        revenueCents: cents,
        percentage: total > 0 ? (cents / total) * 100 : 0,
        config: PLATFORM_CONFIG[platform] ?? {
          label: platform,
          icon: () => null,
          color: 'bg-gray-400',
        },
      }))
      .sort((a, b) => b.revenueCents - a.revenueCents);
  }, [breakdown, total]);

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="mb-2 h-4 w-24" />
              <Skeleton className="mb-2 h-8 w-32" />
              <Skeleton className="h-2 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (platforms.length === 0) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center text-muted-foreground">
          No revenue data by platform
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {platforms.map(({ platform, revenueCents, percentage, config }) => {
        const Icon = config.icon;
        return (
          <Card key={platform} data-test="revenue-platform-card">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                <div className="flex items-center gap-2">
                  <div className={`rounded p-1 text-white ${config.color}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  {config.label}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrencyAmount(
                  { currency, cents: revenueCents },
                  WHOLE_UNITS,
                )}
              </div>
              <div className="mt-2 space-y-1">
                <Progress value={percentage} className="h-2" />
                <p className="text-xs text-muted-foreground">
                  {percentage.toFixed(1)}% of total
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export function RevenuePlatformBreakdownSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {[1, 2, 3].map((i) => (
        <Card key={i}>
          <CardContent className="p-4">
            <Skeleton className="mb-2 h-4 w-24" />
            <Skeleton className="mb-2 h-8 w-32" />
            <Skeleton className="h-2 w-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
