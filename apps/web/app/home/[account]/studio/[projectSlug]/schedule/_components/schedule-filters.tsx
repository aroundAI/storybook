'use client';

import { useOptimistic, useTransition } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { Loader2 } from 'lucide-react';

import {
  OFFERED_PLATFORMS,
  PLATFORM_NAMES,
} from '@kit/publishing/lib/platforms';
import {
  type ScheduleFilters as Filters,
  MAX_CALENDAR_DAYS,
  SCHEDULE_STATUSES,
  type ScheduleType,
  parseScheduleFilters,
  scheduleStatusOf,
} from '@kit/publishing/lib/schedule-view';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

const ALL = 'all';

const TYPES: Array<{ value: ScheduleType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'long', label: 'Long videos' },
  { value: 'short', label: 'Shorts' },
];

/**
 * FILM-2211. The Schedule page's filters live in its URL: each change
 * replaces a search param and the server reads the table again.
 */
export function ScheduleFilters(props: {
  filters: Pick<Filters, 'from' | 'to'>;
  clamped: boolean;
  /** KB-207: posts of deleted episodes the table leaves out */
  hiddenDeleted: number;
  /** KB-213: of those, the ones still live on their platform */
  liveDeleted: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  // The URL a change asked for: the next change builds on it, not on the
  // search params, which lag until the server has answered
  const [params, setParams] = useOptimistic(searchParams?.toString() ?? '');
  const shown = parseScheduleFilters(
    Object.fromEntries(new URLSearchParams(params)),
    new Date(),
  );

  const set = (name: string, value: string | null) => {
    const next = new URLSearchParams(params);

    if (value === null || value === ALL) next.delete(name);
    else next.set(name, value);

    startTransition(() => {
      setParams(next.toString());
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    });
  };

  return (
    <div
      className="flex flex-wrap items-end gap-4"
      data-test="schedule-filters"
      data-pending={pending}
    >
      <div className="space-y-1.5">
        <Label>Type</Label>
        <div className="flex gap-1" role="group" aria-label="Type">
          {TYPES.map((type) => (
            <Button
              key={type.value}
              type="button"
              size="sm"
              variant={shown.type === type.value ? 'default' : 'outline'}
              aria-pressed={shown.type === type.value}
              data-test={`schedule-type-${type.value}`}
              onClick={() => set('type', type.value)}
            >
              {type.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schedule-platform">Platform</Label>
        <Select
          value={shown.platform ?? ALL}
          onValueChange={(value) => set('platform', value)}
        >
          <SelectTrigger
            id="schedule-platform"
            className="w-40"
            data-test="schedule-filter-platform"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All platforms</SelectItem>
            {OFFERED_PLATFORMS.map((platform) => (
              <SelectItem key={platform} value={platform}>
                {PLATFORM_NAMES[platform]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schedule-status">Status</Label>
        <Select
          value={shown.status ?? ALL}
          onValueChange={(value) => set('status', value)}
        >
          <SelectTrigger
            id="schedule-status"
            className="w-40"
            data-test="schedule-filter-status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {SCHEDULE_STATUSES.map((status) => (
              <SelectItem key={status} value={status}>
                {scheduleStatusOf(status).label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schedule-from">From</Label>
        <Input
          id="schedule-from"
          type="date"
          className="w-40"
          // A new value from the URL replaces what was typed
          key={`from-${props.filters.from}`}
          defaultValue={props.filters.from}
          data-test="schedule-from"
          onChange={(event) =>
            event.target.value && set('from', event.target.value)
          }
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="schedule-to">To</Label>
        <Input
          id="schedule-to"
          type="date"
          className="w-40"
          key={`to-${props.filters.to}`}
          defaultValue={props.filters.to}
          data-test="schedule-to"
          onChange={(event) =>
            event.target.value && set('to', event.target.value)
          }
        />
      </div>

      <div className="flex items-center gap-2 pb-2">
        <Checkbox
          id="schedule-deleted"
          checked={shown.deletedEpisodes}
          onCheckedChange={(checked) => set('deleted', checked ? '1' : null)}
          data-test="schedule-show-deleted"
        />
        <Label htmlFor="schedule-deleted" className="font-normal">
          Deleted episodes
          {props.hiddenDeleted > 0 && (
            <span
              className="text-muted-foreground"
              data-test="schedule-hidden-deleted"
            >
              {' '}
              ({props.hiddenDeleted} hidden)
            </span>
          )}
          {props.liveDeleted > 0 && (
            <span
              className="text-destructive"
              data-test="schedule-live-deleted"
            >
              {' '}
              {props.liveDeleted} still live
            </span>
          )}
        </Label>
      </div>

      {pending && (
        <Loader2
          className="mb-2 h-4 w-4 animate-spin text-muted-foreground"
          aria-label="Loading"
          data-test="schedule-loading"
        />
      )}

      {props.clamped && (
        <p
          className="w-full text-sm text-muted-foreground"
          data-test="schedule-clamped"
        >
          Shows at most {MAX_CALENDAR_DAYS} days from the start date.
        </p>
      )}
    </div>
  );
}
