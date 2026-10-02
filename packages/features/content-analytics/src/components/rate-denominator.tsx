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
  className,
}: {
  denominator: DenominatorStamp;
  /** What the figure is, for the button's accessible name: "engagement rate". */
  figure: string;
  className?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`What the ${figure} was divided by`}
          data-test="rate-denominator-trigger"
          data-crosses={denominator.crosses.length > 0}
          className={cn(
            'inline-flex shrink-0 items-center rounded-sm align-middle text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
            className,
          )}
        >
          <Info className="h-3 w-3" aria-hidden />
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
