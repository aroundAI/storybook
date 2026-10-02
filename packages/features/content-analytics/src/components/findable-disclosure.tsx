'use client';

import { type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { ChevronRight } from 'lucide-react';

import { Collapsible, CollapsibleTrigger } from '@kit/ui/collapsible';
import { cn } from '@kit/ui/utils';

/**
 * A disclosure whose content stays in the DOM (FILM-1706, FILM-1719).
 *
 * Radix's `CollapsibleContent` renders nothing while closed, so browser
 * find could never reach what it holds. The region is ours instead: React
 * renders it `hidden`, and once mounted it is upgraded to
 * `hidden="until-found"`, which lets find-in-page match inside it and fire
 * `beforematch` — the cue to open. Radix still owns the trigger, so
 * `aria-expanded` and the keyboard behave as its other disclosures do.
 */
export function FindableDisclosure({
  label,
  regionLabel,
  triggerTestId,
  regionTestId,
  className,
  children,
}: {
  label: ReactNode;
  regionLabel: string;
  triggerTestId?: string;
  regionTestId?: string;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const region = useRef<HTMLDivElement>(null);

  // A DOM event with no React prop, and an attribute value React cannot
  // express (it renders `hidden` as a boolean). Both need the element.
  useEffect(() => {
    const element = region.current;

    if (!element) return;

    if (!open) element.setAttribute('hidden', 'until-found');

    const reveal = () => setOpen(true);

    element.addEventListener('beforematch', reveal);

    return () => element.removeEventListener('beforematch', reveal);
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        aria-controls={regionId}
        className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        data-test={triggerTestId}
      >
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 transition-transform', open && 'rotate-90')}
        />
        {label}
      </CollapsibleTrigger>

      <div
        id={regionId}
        ref={region}
        role="region"
        aria-label={regionLabel}
        hidden={!open}
        className={cn('mt-3 flex flex-col gap-3 text-sm', className)}
        data-test={regionTestId}
      >
        {children}
      </div>
    </Collapsible>
  );
}
