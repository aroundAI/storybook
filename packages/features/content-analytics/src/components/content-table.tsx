'use client';

import { useMemo, useState } from 'react';

import Image from 'next/image';

import { format } from 'date-fns';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
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
import { BULK_TAG_MAX_TAGS } from '../lib/schemas/taxonomy.schema';
import { VIEWS_NOT_MEASURED, formatViews } from '../lib/views';
import type { ContentListItem } from '../server/aggregation-queries';
import type { ContentTag } from './taxonomy/tag-manager';
import { TagPicker } from './taxonomy/tag-picker';

type SortField =
  | 'views'
  | 'likes'
  | 'comments'
  | 'engagementRate'
  | 'publishedAt';
type SortDirection = 'asc' | 'desc';

function SortIcon({
  field,
  sortField,
  sortDirection,
}: {
  field: SortField;
  sortField: SortField;
  sortDirection: SortDirection;
}) {
  if (sortField !== field) {
    return <ArrowUpDown className="ml-1 h-3 w-3" />;
  }
  return sortDirection === 'desc' ? (
    <ArrowDown className="ml-1 h-3 w-3" />
  ) : (
    <ArrowUp className="ml-1 h-3 w-3" />
  );
}

/** What the table needs to show tags and to tag the selected rows. */
export interface ContentTableTagging {
  /** The account's vocabulary, for the picker */
  tags: ContentTag[];
  /** Tags currently on each publish, keyed by publish id */
  tagsByPublish: Record<string, ContentTag[]>;
  isLoading: boolean;
  /** The vocabulary or the assignments could not be read */
  isError: boolean;
  /** Resolves to the refusal message, or null once every publish is tagged */
  onApply: (publishIds: string[], tagIds: string[]) => Promise<string | null>;
}

export interface ContentTableProps {
  data: ContentListItem[] | undefined;
  isLoading?: boolean;
  limit?: number;
  onRowClick?: (item: ContentListItem) => void;
  /** Adds the tags column and row selection with a bulk "tag selected" action */
  tagging?: ContentTableTagging;
}

interface BulkTagState {
  selected: ReadonlySet<string>;
  draftTagIds: string[];
  status: 'idle' | 'saving' | 'done' | 'refused';
  message: string | null;
}

const IDLE_BULK_TAG: BulkTagState = {
  selected: new Set(),
  draftTagIds: [],
  status: 'idle',
  message: null,
};

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
  tagging,
}: ContentTableProps) {
  const [sortField, setSortField] = useState<SortField>('views');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [bulk, setBulk] = useState<BulkTagState>(IDLE_BULK_TAG);

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
          // Not measured sorts after every figure, either way (KB-153).
          aVal = a.views ?? Number.NEGATIVE_INFINITY;
          bVal = b.views ?? Number.NEGATIVE_INFINITY;
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
          aVal = a.engagementRate ?? Number.NEGATIVE_INFINITY;
          bVal = b.engagementRate ?? Number.NEGATIVE_INFINITY;
          break;
        case 'publishedAt':
          aVal = a.publishedAt;
          bVal = b.publishedAt;
          break;
        default:
          aVal = a.views ?? Number.NEGATIVE_INFINITY;
          bVal = b.views ?? Number.NEGATIVE_INFINITY;
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

  const toggleRow = (publishId: string) => {
    const selected = new Set(bulk.selected);

    if (!selected.delete(publishId)) selected.add(publishId);

    setBulk({ ...bulk, selected, status: 'idle', message: null });
  };

  // Only rows still on screen: a filter change can drop rows that were ticked.
  const selectedIds = sortedData
    .filter((item) => bulk.selected.has(item.publishId))
    .map((item) => item.publishId);
  const allSelected =
    sortedData.length > 0 && selectedIds.length === sortedData.length;
  const someSelected = selectedIds.length > 0 && !allSelected;

  const toggleAll = () => {
    setBulk({
      ...bulk,
      selected: allSelected
        ? new Set()
        : new Set(sortedData.map((item) => item.publishId)),
      status: 'idle',
      message: null,
    });
  };

  const applyTags = async () => {
    if (!tagging) return;

    setBulk({ ...bulk, status: 'saving', message: null });

    const refusal = await tagging.onApply(selectedIds, bulk.draftTagIds);

    setBulk(
      refusal === null
        ? {
            ...IDLE_BULK_TAG,
            status: 'done',
            message: `Tagged ${selectedIds.length} ${selectedIds.length === 1 ? 'video' : 'videos'}.`,
          }
        : { ...bulk, status: 'refused', message: refusal },
    );
  };

  if (isLoading) {
    return <ContentTableSkeleton />;
  }

  if (!data || data.length === 0) {
    return (
      <div className="py-8 text-center text-muted-foreground">
        No content published yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-test="content-table">
      {tagging ? (
        <BulkTagBar
          tagging={tagging}
          bulk={bulk}
          selectedCount={selectedIds.length}
          onDraftChange={(draftTagIds) =>
            setBulk({ ...bulk, draftTagIds, status: 'idle', message: null })
          }
          onApply={applyTags}
          onClear={() => setBulk(IDLE_BULK_TAG)}
        />
      ) : null}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              {tagging ? (
                <TableHead className="w-10">
                  <Checkbox
                    checked={
                      allSelected
                        ? true
                        : someSelected
                          ? 'indeterminate'
                          : false
                    }
                    onCheckedChange={toggleAll}
                    aria-label="Select all content"
                    data-test="content-select-all"
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-[300px]">Content</TableHead>
              <TableHead className="w-[100px]">Platform</TableHead>
              {tagging ? (
                <TableHead className="w-[200px]">Tags</TableHead>
              ) : null}
              <TableHead
                className="w-[100px] cursor-pointer"
                onClick={() => handleSort('views')}
              >
                <div className="flex items-center">
                  Views
                  <SortIcon
                    field="views"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="w-[80px] cursor-pointer"
                onClick={() => handleSort('likes')}
              >
                <div className="flex items-center">
                  Likes
                  <SortIcon
                    field="likes"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="w-[100px] cursor-pointer"
                onClick={() => handleSort('comments')}
              >
                <div className="flex items-center">
                  Comments
                  <SortIcon
                    field="comments"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="w-[100px] cursor-pointer"
                onClick={() => handleSort('engagementRate')}
              >
                <div className="flex items-center">
                  Engagement
                  <SortIcon
                    field="engagementRate"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
                </div>
              </TableHead>
              <TableHead
                className="w-[120px] cursor-pointer"
                onClick={() => handleSort('publishedAt')}
              >
                <div className="flex items-center">
                  Published
                  <SortIcon
                    field="publishedAt"
                    sortField={sortField}
                    sortDirection={sortDirection}
                  />
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
                data-test="content-row"
                data-state={
                  bulk.selected.has(item.publishId) ? 'selected' : undefined
                }
              >
                {tagging ? (
                  <TableCell onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      checked={bulk.selected.has(item.publishId)}
                      onCheckedChange={() => toggleRow(item.publishId)}
                      aria-label={`Select ${item.publishTitle}`}
                      data-test="content-row-select"
                    />
                  </TableCell>
                ) : null}
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
                      <div className="h-10 w-16 rounded bg-muted" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {item.publishTitle}
                      </div>
                      <div className="truncate text-sm text-muted-foreground">
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
                {tagging ? (
                  <TableCell data-test="content-row-tags">
                    <TagChips
                      tags={tagging.tagsByPublish[item.publishId]}
                      isLoading={tagging.isLoading}
                      isError={tagging.isError}
                    />
                  </TableCell>
                ) : null}
                <TableCell data-test="content-views">
                  {formatViews(item.views, formatNumber)}
                </TableCell>
                <TableCell>{formatNumber(item.likes)}</TableCell>
                <TableCell>{formatNumber(item.comments)}</TableCell>
                <TableCell>
                  {item.engagementRate === null ? (
                    <span className="text-muted-foreground">
                      {VIEWS_NOT_MEASURED}
                    </span>
                  ) : (
                    <EngagementBadge rate={item.engagementRate} />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(item.publishedAt), 'MMM d, yyyy')}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TagChips({
  tags,
  isLoading,
  isError,
}: {
  tags: ContentTag[] | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) return <Skeleton className="h-5 w-24" />;

  if (isError) {
    return <span className="text-xs text-muted-foreground">Not loaded</span>;
  }

  if (!tags || tags.length === 0) {
    return <span className="text-xs text-muted-foreground">Untagged</span>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag.id} variant="secondary" className="text-xs">
          {tag.label}
        </Badge>
      ))}
    </div>
  );
}

function BulkTagBar({
  tagging,
  bulk,
  selectedCount,
  onDraftChange,
  onApply,
  onClear,
}: {
  tagging: ContentTableTagging;
  bulk: BulkTagState;
  selectedCount: number;
  onDraftChange: (tagIds: string[]) => void;
  onApply: () => void;
  onClear: () => void;
}) {
  const count = selectedCount;
  const isSaving = bulk.status === 'saving';
  const tooManyTags = bulk.draftTagIds.length > BULK_TAG_MAX_TAGS;

  return (
    <div className="flex flex-col gap-2" data-test="content-bulk-bar">
      {tagging.isError ? (
        <p
          className="text-sm text-destructive"
          role="alert"
          data-test="content-tags-error"
        >
          Tags could not be loaded, so tagging is unavailable. This is a fetch
          failure, not an absence of tags.
        </p>
      ) : null}

      {count > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-2">
          <span
            className="text-sm font-medium"
            data-test="content-selected-count"
          >
            {count} selected
          </span>
          <TagPicker
            tags={tagging.tags}
            selectedTagIds={bulk.draftTagIds}
            onChange={onDraftChange}
            placeholder="Choose tags"
            disabled={isSaving}
            isLoading={tagging.isLoading}
            isError={tagging.isError}
          />
          <Button
            type="button"
            size="sm"
            onClick={onApply}
            disabled={
              isSaving ||
              bulk.draftTagIds.length === 0 ||
              tooManyTags ||
              tagging.isError
            }
            data-test="content-tag-selected"
          >
            {isSaving ? 'Tagging…' : 'Tag selected'}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClear}
            disabled={isSaving}
            data-test="content-clear-selection"
          >
            Clear
          </Button>
          {tooManyTags ? (
            <span className="text-xs text-destructive">
              Choose at most {BULK_TAG_MAX_TAGS} tags at a time.
            </span>
          ) : null}
        </div>
      ) : null}

      {bulk.message ? (
        <p
          className={
            bulk.status === 'refused'
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
          role={bulk.status === 'refused' ? 'alert' : 'status'}
          data-test={
            bulk.status === 'refused'
              ? 'content-bulk-refused'
              : 'content-bulk-done'
          }
        >
          {bulk.message}
        </p>
      ) : null}
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
