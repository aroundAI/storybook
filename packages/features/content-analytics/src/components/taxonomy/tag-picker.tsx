'use client';

import { Check, Tag as TagIcon } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Skeleton } from '@kit/ui/skeleton';
import { cn } from '@kit/ui/utils';

import type { ContentTag } from './tag-manager';

/**
 * `id` and aria attributes go to the trigger, so `FormControl` can tie it to
 * its label and error message (as the video picker does).
 */
interface TagPickerProps
  extends Pick<
    React.ComponentPropsWithoutRef<'button'>,
    'id' | 'aria-describedby' | 'aria-invalid'
  > {
  /** The full account vocabulary to choose from */
  tags: ContentTag[];
  /** Currently selected tag ids */
  selectedTagIds: string[];
  /** Called with the next selection whenever a tag is toggled */
  onChange: (tagIds: string[]) => void;
  /** Trigger label when nothing is selected */
  placeholder?: string;
  /** Disables interaction while a save is in flight */
  disabled?: boolean;
  isLoading?: boolean;
  /** The vocabulary could not be read: say so, never "no tags". */
  isError?: boolean;
  /** Said when the account has no tags yet */
  emptyText?: string;
}

const DIMENSION_LABELS: Record<string, string> = {
  topic: 'Topic',
  format: 'Format',
  thumbnail_style: 'Thumbnail style',
  hook_type: 'Hook type',
};

/**
 * Multi-select over the account's tag vocabulary, grouped by dimension.
 */
export function TagPicker({
  tags,
  selectedTagIds,
  onChange,
  placeholder = 'Add tags',
  disabled = false,
  isLoading = false,
  isError = false,
  emptyText = 'No tags defined yet.',
  ...triggerProps
}: TagPickerProps) {
  if (isLoading) {
    return <Skeleton className={'h-8 w-40'} />;
  }

  if (isError) {
    return (
      <p
        className={'text-sm text-muted-foreground'}
        data-test={'tag-picker-error'}
      >
        Tags could not be loaded.
      </p>
    );
  }

  const selected = new Set(selectedTagIds);

  const grouped = tags.reduce<Record<string, ContentTag[]>>((acc, tag) => {
    acc[tag.dimension] = [...(acc[tag.dimension] ?? []), tag];
    return acc;
  }, {});

  const toggle = (tagId: string) => {
    onChange(
      selected.has(tagId)
        ? selectedTagIds.filter((id) => id !== tagId)
        : [...selectedTagIds, tagId],
    );
  };

  const selectedTags = tags.filter((tag) => selected.has(tag.id));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type={'button'}
          variant={'outline'}
          size={'sm'}
          disabled={disabled}
          className={'h-8 gap-2'}
          data-test={'tag-picker-trigger'}
          {...triggerProps}
        >
          <TagIcon className={'h-3.5 w-3.5'} />
          {selectedTags.length > 0 ? (
            <span className={'flex flex-wrap items-center gap-1'}>
              {selectedTags.slice(0, 2).map((tag) => (
                <Badge key={tag.id} variant={'secondary'} className={'text-xs'}>
                  {tag.label}
                </Badge>
              ))}
              {selectedTags.length > 2 ? (
                <span className={'text-xs text-muted-foreground'}>
                  +{selectedTags.length - 2}
                </span>
              ) : null}
            </span>
          ) : (
            <span className={'text-muted-foreground'}>{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent className={'w-64 p-0'} align={'start'}>
        <ScrollArea className={'max-h-72'}>
          {tags.length === 0 ? (
            <p
              className={'p-4 text-sm text-muted-foreground'}
              data-test={'tag-picker-empty'}
            >
              {emptyText}
            </p>
          ) : (
            <div className={'flex flex-col gap-3 p-3'}>
              {Object.entries(grouped).map(([dimension, dimensionTags]) => (
                <div key={dimension} className={'flex flex-col gap-1'}>
                  <p
                    className={
                      'px-1 text-xs font-medium text-muted-foreground uppercase'
                    }
                  >
                    {DIMENSION_LABELS[dimension] ?? dimension}
                  </p>

                  {dimensionTags.map((tag) => (
                    <button
                      key={tag.id}
                      type={'button'}
                      onClick={() => toggle(tag.id)}
                      aria-pressed={selected.has(tag.id)}
                      data-test={`tag-picker-option-${tag.id}`}
                      className={cn(
                        'flex items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent',
                        selected.has(tag.id) && 'font-medium',
                      )}
                    >
                      {tag.label}
                      {selected.has(tag.id) ? (
                        <Check className={'h-3.5 w-3.5'} />
                      ) : null}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
