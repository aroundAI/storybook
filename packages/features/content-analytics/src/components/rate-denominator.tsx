'use client';

import { Info } from 'lucide-react';

import { type DenominatorStamp, denominatorSentence } from '@kit/clickhouse';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { cn } from '@kit/ui/utils';

/**
 * What a rate was divided by (FILM-1732): a button beside the figure that
 * opens the record's sentence — the views definitions, the window, and any
 * change the window crosses. The figure itself is unchanged; whether a
 * crossing also earns a visible marker is the owner's call (FILM-1732, open
 * questions), so `data-crosses` carries it for tests and nothing else.
 */
export function RateDenominator({
  denominator,
  figure,
  subject,
  className,
}: {
  denominator: DenominatorStamp;
  /** What the figure is, for the button's accessible name: "engagement rate". */
  figure: string;
  /**
   * Whose figure it is, where one card repeats the button per row: the
   * video, language or tag. Without it every row's button reads the same.
   */
  subject?: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={
            subject
              ? `What the ${figure} of ${subject} was divided by`
              : `What the ${figure} was divided by`
          }
          data-test="rate-denominator-trigger"
          data-crosses={denominator.crosses.length > 0}
          className={cn(
            // 24px to touch (WCAG 2.5.8), drawn at 14px; the negative margin
            // keeps the line it sits in from growing.
            '-m-[5px] inline-flex size-6 shrink-0 items-center justify-center rounded-sm align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            className,
          )}
        >
          <Info className="size-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-test="rate-denominator"
        className="w-80 text-xs leading-relaxed"
      >
        {denominatorSentence(denominator)}
      </PopoverContent>
    </Popover>
  );
}
