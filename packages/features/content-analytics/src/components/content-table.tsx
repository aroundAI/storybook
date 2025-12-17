'use client';

import { useMemo, useState } from 'react';

import Image from 'next/image';

import { format } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
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
import type { ContentListItem } from '../server/aggregation-queries';

type SortField =
  | 'views'
  | 'likes'
  | 'comments'
  | 'engagementRate'
  | 'publishedAt';
type SortDirection = 'asc' | 'desc';

export interface ContentTableProps {
  data: ContentListItem[] | undefined;
  isLoading?: boolean;
  limit?: number;
  onRowClick?: (item: ContentListItem) => void;
}

const PLATFORM_COLORS: Record<string, string> = {
  youtube: 'bg-red-500 text-white',
  tiktok: 'bg-black text-white',
  instagram: 'bg-gradient-to-r from-purple-500 to-pink-500 text-white',
};

export function ContentTable({
  data,
  isLoading = false,
  limit,
  onRowClick,
}: ContentTableProps) {
  const [sortField, setSortField] = useState<SortField>('views');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const sortedData = useMemo(() => {
    if (!data) return [];

    const sorted = [...data].sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;

      switch (sortField) {
        case 'views':
          aVal = a.views;
          bVal = b.views;
          break;
        case 'likes':
          aVal = a.likes;
          bVal = b.likes;
          break;
        case 'comments':
          aVal = a.comments;
          bVal = b.comments;
          break;
        case 'engagementRate':
          aVal = a.engagementRate;
          bVal = b.engagementRate;
          break;
        case 'publishedAt':
          aVal = a.publishedAt;
          bVal = b.publishedAt;
          break;
        default:
          aVal = a.views;
          bVal = b.views;
      }

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDirection === 'desc'
          ? bVal.localeCompare(aVal)
          : aVal.localeCompare(bVal);
      }

      return sortDirection === 'desc'
        ? (bVal as number) - (aVal as number)
        : (aVal as number) - (bVal as number);
    });

    return limit ? sorted.slice(0, limit) : sorted;
  }, [data, sortField, sortDirection, limit]);

  if (isLoading) {
    return <ContentTableSkeleton />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="text-muted-foreground py-8 text-center">
        No content published yet.
      </div>
    );
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <ArrowUpDown className="ml-1 h-3 w-3" />;
    }
    return sortDirection === 'desc' ? (
      <ArrowDown className="ml-1 h-3 w-3" />
    ) : (
      <ArrowUp className="ml-1 h-3 w-3" />
    );
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[300px]">Content</TableHead>
            <TableHead className="w-[100px]">Platform</TableHead>
            <TableHead
              className="w-[100px] cursor-pointer"
              onClick={() => handleSort('views')}
            >
              <div className="flex items-center">
                Views
                <SortIcon field="views" />
              </div>
            </TableHead>
            <TableHead
              className="w-[80px] cursor-pointer"
              onClick={() => handleSort('likes')}
            >
              <div className="flex items-center">
                Likes
                <SortIcon field="likes" />
              </div>
            </TableHead>
            <TableHead
              className="w-[100px] cursor-pointer"
              onClick={() => handleSort('comments')}
            >
              <div className="flex items-center">
                Comments
                <SortIcon field="comments" />
              </div>
            </TableHead>
            <TableHead
              className="w-[100px] cursor-pointer"
              onClick={() => handleSort('engagementRate')}
            >
              <div className="flex items-center">
                Engagement
                <SortIcon field="engagementRate" />
              </div>
            </TableHead>
            <TableHead
              className="w-[120px] cursor-pointer"
              onClick={() => handleSort('publishedAt')}
            >
              <div className="flex items-center">
                Published
                <SortIcon field="publishedAt" />
              </div>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedData.map((item) => (
            <TableRow
              key={item.publishId}
              className={onRowClick ? 'cursor-pointer' : ''}
              onClick={() => onRowClick?.(item)}
            >
              <TableCell>
                <div className="flex items-center gap-3">
                  {item.thumbnailUrl ? (
                    <div className="relative h-10 w-16 overflow-hidden rounded">
                      <Image
                        src={item.thumbnailUrl}
                        alt={item.publishTitle}
                        fill
                        className="object-cover"
                        sizes="64px"
                        unoptimized
                      />
                    </div>
                  ) : (
                    <div className="bg-muted h-10 w-16 rounded" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {item.publishTitle}
                    </div>
                    <div className="text-muted-foreground truncate text-sm">
                      {item.episodeTitle}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  variant="secondary"
                  className={`capitalize ${PLATFORM_COLORS[item.platform] || ''}`}
                >
                  {item.platform}
                </Badge>
              </TableCell>
              <TableCell>{formatNumber(item.views)}</TableCell>
              <TableCell>{formatNumber(item.likes)}</TableCell>
              <TableCell>{formatNumber(item.comments)}</TableCell>
              <TableCell>
                <EngagementBadge rate={item.engagementRate} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {format(new Date(item.publishedAt), 'MMM d, yyyy')}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function EngagementBadge({ rate }: { rate: number }) {
  const color =
    rate > 5
      ? 'text-green-600 dark:text-green-400'
      : rate > 2
        ? 'text-yellow-600 dark:text-yellow-400'
        : 'text-muted-foreground';

  return <span className={color}>{rate.toFixed(1)}%</span>;
}

function ContentTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-10 w-16" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-6 w-16" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
