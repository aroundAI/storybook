'use client';

import { useMemo } from 'react';

import { Badge } from '@kit/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Skeleton } from '@kit/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kit/ui/table';

import { formatNumber } from '../lib/format';
import { DEFAULT_CURRENCY, formatCurrencyAmount } from '../lib/money';
import type { TopRevenueContent } from '../lib/types/revenue';

interface RevenueTopContentProps {
  data: TopRevenueContent[];
  /**
   * The currency `data` is ranked in. A ranking across currencies orders
   * nothing, so a table holds one (KB-12).
   */
  currency?: string | null;
  /** Shown beside the title when the account has more than one currency. */
  titleSuffix?: string;
  isLoading?: boolean;
}

const WHOLE_UNITS = { minimumFractionDigits: 0, maximumFractionDigits: 0 };

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'bg-red-100 text-red-700',
  tiktok: 'bg-gray-100 text-gray-700',
  instagram: 'bg-pink-100 text-pink-700',
  facebook: 'bg-blue-100 text-blue-700',
  twitter: 'bg-sky-100 text-sky-700',
  linkedin: 'bg-blue-100 text-blue-700',
};

export function RevenueTopContent({
  data,
  currency = DEFAULT_CURRENCY,
  titleSuffix = '',
  isLoading,
}: RevenueTopContentProps) {
  const formatCents = (cents: number) =>
    formatCurrencyAmount({ currency, cents }, WHOLE_UNITS);

  const sortedData = useMemo(
    () => [...data].sort((a, b) => b.revenueCents - a.revenueCents),
    [data],
  );

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Content{titleSuffix}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4">
                <Skeleton className="h-12 w-20 rounded" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-6 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (sortedData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Top Performing Content{titleSuffix}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            No revenue data for this period
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card data-test="revenue-top-content">
      <CardHeader>
        <CardTitle>Top Performing Content{titleSuffix}</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Content</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead className="text-right">Views</TableHead>
              <TableHead className="text-right">Revenue</TableHead>
              <TableHead className="text-right">RPM</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map((item, index) => (
              <TableRow
                key={item.publishId}
                data-test="revenue-top-content-row"
              >
                <TableCell>
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground">
                      #{index + 1}
                    </span>
                    {item.thumbnailUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.thumbnailUrl}
                        alt={item.title}
                        width={64}
                        height={36}
                        className="h-9 w-16 rounded object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-16 items-center justify-center rounded bg-muted">
                        <span className="text-xs text-muted-foreground">
                          No img
                        </span>
                      </div>
                    )}
                    <span className="line-clamp-2 font-medium">
                      {item.title}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="secondary"
                    className={PLATFORM_COLORS[item.platform] ?? 'bg-gray-100'}
                  >
                    {item.platform}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatNumber(item.views)}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {formatCents(item.revenueCents)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCents(item.rpm)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export function RevenueTopContentSkeleton() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Top Performing Content</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-12 w-20 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-6 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
