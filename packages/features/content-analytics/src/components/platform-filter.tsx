'use client';

import { useMemo } from 'react';

import { Filter } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';

const PLATFORMS = [
  { id: 'youtube', label: 'YouTube', color: 'bg-red-500' },
  { id: 'tiktok', label: 'TikTok', color: 'bg-black' },
  {
    id: 'instagram',
    label: 'Instagram',
    color: 'bg-gradient-to-r from-purple-500 to-pink-500',
  },
] as const;

export type Platform = (typeof PLATFORMS)[number]['id'];

export interface PlatformFilterProps {
  selected: Platform[];
  onChange: (platforms: Platform[]) => void;
  available?: Platform[];
}

export function PlatformFilter({
  selected,
  onChange,
  available = ['youtube', 'tiktok', 'instagram'],
}: PlatformFilterProps) {
  const platforms = useMemo(
    () => PLATFORMS.filter((p) => available.includes(p.id)),
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
    onChange(available);
  };

  const handleClearAll = () => {
    onChange([]);
  };

  const allSelected = selected.length === available.length;
  const noneSelected = selected.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Filter className="h-4 w-4" />
          <span>Platforms</span>
          {selected.length > 0 && selected.length < available.length && (
            <Badge variant="secondary" className="ml-1 h-5 px-1.5">
              {selected.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56">
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
                className="hover:bg-muted flex cursor-pointer items-center gap-3 rounded-md p-2"
              >
                <Checkbox
                  checked={selected.includes(platform.id)}
                  onCheckedChange={() => handleToggle(platform.id)}
                />
                <div className="flex items-center gap-2">
                  <div className={`h-3 w-3 rounded-full ${platform.color}`} />
                  <span className="text-sm">{platform.label}</span>
                </div>
              </label>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
