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

interface ChannelFilterProps
  extends Pick<
    React.ComponentPropsWithoutRef<'button'>,
    'id' | 'aria-describedby' | 'aria-invalid'
  > {
  channels: ChannelRef[];
  /** `undefined` is "All channels" */
  value: string | undefined;
  onChange: (connectionId: string | undefined) => void;
  isLoading?: boolean;
  /** The channel list failed to load — say so rather than offering nothing */
  isError?: boolean;
  /**
   * What "no channel" means where this is used. On the Deep Dive it is every
   * channel; on an experiment it is none in particular.
   */
  allLabel?: string;
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
  isError = false,
  allLabel = 'All channels',
  ...triggerProps
}: ChannelFilterProps) {
  if (isLoading) {
    return <Skeleton className={'h-9 w-56'} />;
  }

  // An empty list and a failed read look identical in a dropdown: both offer
  // "All channels" and nothing else. Only one of them means this project
  // publishes nowhere.
  if (isError) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'channel-filter-error'}
      >
        Channels could not be loaded.
      </p>
    );
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
        // A visible label, when there is one, names the trigger through
        // FormControl's id; this is the fallback for the Deep Dive, which
        // has none.
        aria-label={triggerProps.id ? undefined : 'Channel'}
        data-test={'channel-filter-trigger'}
        {...triggerProps}
      >
        <SelectValue />
      </SelectTrigger>

      <SelectContent>
        <SelectItem
          value={ALL_CHANNELS}
          data-test={'channel-filter-option-all'}
        >
          {allLabel}
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
