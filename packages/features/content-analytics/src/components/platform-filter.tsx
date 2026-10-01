'use client';

import { useMemo } from 'react';

import { Filter } from 'lucide-react';

import { ANALYTICS_PLATFORMS, type AnalyticsPlatform } from '@kit/clickhouse';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

import { platformLabel } from '../lib/platform-labels';

const PLATFORM_COLORS: Partial<Record<AnalyticsPlatform, string>> = {
  youtube: 'bg-red-500',
  tiktok: 'bg-black',
  instagram: 'bg-gradient-to-r from-purple-500 to-pink-500',
  facebook: 'bg-blue-600',
};

/**
 * Every analytics platform is offered (FILM-1709 × FILM-1720): one the
 * filter cannot name is one "every platform" silently drops. The list is
 * the shared one, so a platform added to `AnalyticsPlatform` appears here.
 */
const PLATFORMS = ANALYTICS_PLATFORMS.map((id) => ({
  id,
  label: platformLabel(id),
  color: PLATFORM_COLORS[id] ?? 'bg-muted-foreground',
}));

export type Platform = AnalyticsPlatform;

export interface PlatformFilterProps {
  selected: Platform[];
  onChange: (platforms: Platform[]) => void;
  /**
   * The platforms the current tab's cards can cover. The others are still
   * offered — dimmed, with `reasons`, and selectable (FILM-1705 §3): a
   * platform missing from the list reads as one the product does not
   * support, and leaves nothing to explain why.
   */
  available?: readonly AnalyticsPlatform[];
  /** Why each unavailable platform is unavailable, in a sentence. */
  reasons?: Partial<Record<AnalyticsPlatform, string>>;
}

const ALL_PLATFORMS: Platform[] = PLATFORMS.map((platform) => platform.id);

export function PlatformFilter({
  selected,
  onChange,
  available = ALL_PLATFORMS,
  reasons = {},
}: PlatformFilterProps) {
  const platforms = useMemo(
    () =>
      PLATFORMS.map((platform) => ({
        ...platform,
        available: available.includes(platform.id),
      })),
    [available],
  );

  const handleToggle = (platformId: Platform) => {
    if (selected.includes(platformId)) {
      onChange(selected.filter((p) => p !== platformId));
    } else {
      onChange([...selected, platformId]);
    }
  };

  const handleSelectAll = () => {
    onChange(ALL_PLATFORMS);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const allSelected = selected.length === ALL_PLATFORMS.length;
  const noneSelected = selected.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          data-test="platform-filter-trigger"
        >
          <Filter className="h-4 w-4" />
          <span>Platforms</span>
          {selected.length > 0 && selected.length < ALL_PLATFORMS.length && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72"
        data-test="platform-filter-options"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filter by Platform</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleSelectAll}
                disabled={allSelected}
                className="h-7 px-2 text-xs"
              >
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                disabled={noneSelected}
                className="h-7 px-2 text-xs"
              >
                None
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {platforms.map((platform) => (
              <label
                key={platform.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md p-2 hover:bg-muted',
                  !platform.available && 'opacity-60',
                )}
                data-test={`platform-filter-${platform.id}`}
                data-available={platform.available ? 'true' : 'false'}
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selected.includes(platform.id)}
                  onCheckedChange={() => handleToggle(platform.id)}
                />
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <div className={`h-3 w-3 rounded-full ${platform.color}`} />
                    <span className="text-sm">{platform.label}</span>
                  </div>
                  {!platform.available && reasons[platform.id] && (
                    <span
                      className="text-xs text-muted-foreground"
                      data-test={`platform-filter-${platform.id}-reason`}
                    >
                      {reasons[platform.id]}
                    </span>
                  )}
                </div>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
