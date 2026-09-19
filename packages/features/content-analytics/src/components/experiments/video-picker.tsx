'use client';

import { useRef, useState } from 'react';

import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@kit/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { Skeleton } from '@kit/ui/skeleton';

/** A published video that can be linked to an experiment. */
export interface LinkableVideo {
  id: string;
  title: string | null;
  platform: string;
  publishedAt: string | null;
}

interface VideoPickerProps
  extends Pick<
    React.ComponentPropsWithoutRef<'button'>,
    'id' | 'aria-describedby' | 'aria-invalid'
  > {
  /** The current search's results, at most one page */
  videos: LinkableVideo[];
  /** More videos match than were returned: ask for a narrower search */
  hasMore: boolean;
  search: string;
  onSearchChange: (search: string) => void;
  /** Selected publish ids */
  value: string[];
  onChange: (publishIds: string[]) => void;
  /** The most that may be linked; the schema's cap */
  max: number;
  /** The first page is loading — nothing to show yet */
  isLoading?: boolean;
  /** The video list failed to load — say so rather than offering nothing */
  isError?: boolean;
}

/**
 * Chooses the videos an experiment is run on (FILM-1610).
 *
 * Searches on the server: the account's videos are never all loaded, since
 * that grows without bound. Controlled — the selection lives in form state
 * only, so a form `reset()` clears it on screen too. Selected videos keep
 * their titles after they drop out of the current results, so a search that
 * no longer matches them does not turn them into bare ids.
 *
 * `id` and the aria attributes go to the trigger button, so `FormControl`
 * can tie it to its label and error message.
 */
export function VideoPicker({
  videos,
  hasMore,
  search,
  onSearchChange,
  value,
  onChange,
  max,
  isLoading = false,
  isError = false,
  ...triggerProps
}: VideoPickerProps) {
  const [open, setOpen] = useState(false);
  // Titles of every video seen, so selections outlive the search that
  // found them. A ref: it is a cache, and changing it should not re-render.
  const seen = useRef(new Map<string, LinkableVideo>());

  for (const video of videos) seen.current.set(video.id, video);

  if (isLoading) {
    return <Skeleton className={'h-9 w-full'} />;
  }

  if (isError) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'video-picker-error'}
      >
        Videos could not be loaded.
      </p>
    );
  }

  if (videos.length === 0 && search.trim() === '' && value.length === 0) {
    return (
      <p
        className={'text-muted-foreground text-sm'}
        data-test={'video-picker-empty'}
      >
        This account has no published videos to link yet.
      </p>
    );
  }

  const selected = new Set(value);
  const atCap = selected.size >= max;

  // Selected videos first, then this search's other results.
  const rows = [
    ...value
      .map((id) => seen.current.get(id))
      .filter((video): video is LinkableVideo => Boolean(video)),
    ...videos.filter((video) => !selected.has(video.id)),
  ];

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(value.filter((existing) => existing !== id));
    } else if (!atCap) {
      onChange([...value, id]);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type={'button'}
          variant={'outline'}
          role={'combobox'}
          aria-expanded={open}
          className={'w-full justify-between font-normal'}
          data-test={'video-picker-trigger'}
          {...triggerProps}
        >
          {selected.size === 0
            ? 'Choose videos'
            : `${selected.size} video${selected.size === 1 ? '' : 's'} linked`}
          <ChevronsUpDown className={'ml-2 h-4 w-4 opacity-50'} />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={'w-[--radix-popover-trigger-width] p-0'}>
        {/* Filtering is the server's: cmdk's own would hide results the
            server returned for a match cmdk does not see. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={'Search video titles'}
            className={'h-9'}
            value={search}
            onValueChange={onSearchChange}
            data-test={'video-picker-search'}
          />
          <CommandList>
            {rows.length === 0 ? (
              <p
                className={'text-muted-foreground p-3 text-sm'}
                data-test={'video-picker-no-match'}
              >
                No video matches.
              </p>
            ) : null}
            <CommandGroup>
              {rows.map((video) => {
                const checked = selected.has(video.id);

                return (
                  <CommandItem
                    key={video.id}
                    value={video.id}
                    onSelect={() => toggle(video.id)}
                    disabled={!checked && atCap}
                    data-test={`video-picker-option-${video.id}`}
                  >
                    {/* Display only: the row's onSelect is the one toggle,
                        so a click on the box cannot toggle it twice. */}
                    <Checkbox
                      checked={checked}
                      tabIndex={-1}
                      aria-hidden
                      className={'pointer-events-none mr-2'}
                    />
                    <span className={'flex-1 truncate'}>
                      {video.title ?? 'Untitled'}
                    </span>
                    <span className={'text-muted-foreground ml-2 text-xs'}>
                      {video.platform}
                      {video.publishedAt
                        ? ` · ${video.publishedAt.slice(0, 10)}`
                        : ''}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>

        {hasMore ? (
          <p
            className={'text-muted-foreground border-t p-2 text-xs'}
            data-test={'video-picker-has-more'}
          >
            {search.trim()
              ? `Showing the newest ${videos.length} matches. Narrow the search to find others.`
              : `Showing the newest ${videos.length}. Search by title to find others.`}
          </p>
        ) : null}

        {atCap ? (
          <p className={'text-muted-foreground border-t p-2 text-xs'}>
            At most {max} videos can be linked to one experiment.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
