'use client';

import { Badge } from '@kit/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Skeleton } from '@kit/ui/skeleton';

import type { ChannelRef } from '../../server/channels';

/**
 * Radix `Select` cannot hold an empty-string value, so "All channels" needs a
 * token. It never leaves this component: `onChange` receives `undefined`, and
 * the scope sent to the actions has no `connectionId` key at all.
 */
const ALL_CHANNELS = 'all';

interface ChannelFilterProps {
  channels: ChannelRef[];
  /** `undefined` is "All channels" */
  value: string | undefined;
  onChange: (connectionId: string | undefined) => void;
  isLoading?: boolean;
}

/**
 * Narrows the Deep Dive tab to one channel of the current project.
 *
 * A filter, never a scope: the project stays the scope and this only adds a
 * `connectionId`, so the tenant check on the project still applies. "All
 * channels" is the default because every figure on the tab was an
 * all-channel figure before this existed.
 *
 * Inactive channels are listed, and marked, because a disconnected channel
 * still owns the history those figures are built from.
 */
export function ChannelFilter({
  channels,
  value,
  onChange,
  isLoading = false,
}: ChannelFilterProps) {
  if (isLoading) {
    return <Skeleton className={'h-9 w-56'} />;
  }

  return (
    <Select
      value={value ?? ALL_CHANNELS}
      onValueChange={(next) =>
        onChange(next === ALL_CHANNELS ? undefined : next)
      }
    >
      <SelectTrigger
        className={'w-64'}
        aria-label={'Channel'}
        data-test={'channel-filter-trigger'}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        <SelectItem
          value={ALL_CHANNELS}
          data-test={'channel-filter-option-all'}
        >
          All channels
        </SelectItem>

        {channels.map((channel) => (
          <SelectItem
            key={channel.connectionId}
            value={channel.connectionId}
            data-test={`channel-filter-option-${channel.connectionId}`}
          >
            <span className={'flex items-center gap-2'}>
              {channel.thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={channel.thumbnailUrl}
                  alt={''}
                  className={'h-4 w-4 rounded-full'}
                />
              ) : null}

              <span>{channel.name}</span>

              {channel.isActive ? null : (
                <Badge
                  variant={'outline'}
                  className={'text-xs'}
                  data-test={'channel-filter-inactive-badge'}
                >
                  Inactive
                </Badge>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
