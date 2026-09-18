'use client';

import { useState } from 'react';

import { ChevronsUpDown } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Command,
  CommandEmpty,
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

interface VideoPickerProps {
  videos: LinkableVideo[];
  /** Selected publish ids */
  value: string[];
  onChange: (publishIds: string[]) => void;
  /** The most that may be linked; the schema's cap */
  max: number;
  isLoading?: boolean;
  /** The video list failed to load — say so rather than offering nothing */
  isError?: boolean;
}

/**
 * Chooses the videos an experiment is run on (FILM-1610).
 *
 * Without this the form could not link anything, so every experiment
 * logged from the UI measured zero videos. Controlled: the selection lives
 * in form state only, so a form `reset()` clears it on screen too.
 */
export function VideoPicker({
  videos,
  value,
  onChange,
  max,
  isLoading = false,
  isError = false,
}: VideoPickerProps) {
  const [open, setOpen] = useState(false);

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

  if (videos.length === 0) {
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
        >
          {selected.size === 0
            ? 'Choose videos'
            : `${selected.size} video${selected.size === 1 ? '' : 's'} linked`}
          <ChevronsUpDown className={'ml-2 h-4 w-4 opacity-50'} />
        </Button>
      </PopoverTrigger>

      <PopoverContent className={'w-[--radix-popover-trigger-width] p-0'}>
        <Command>
          <CommandInput placeholder={'Search videos'} className={'h-9'} />
          <CommandList>
            <CommandEmpty>No video matches.</CommandEmpty>
            <CommandGroup>
              {videos.map((video) => {
                const checked = selected.has(video.id);

                return (
                  <CommandItem
                    key={video.id}
                    value={`${video.title ?? 'Untitled'} ${video.id}`}
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

        {atCap ? (
          <p className={'text-muted-foreground border-t p-2 text-xs'}>
            At most {max} videos can be linked to one experiment.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
