'use client';

import { forwardRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { CheckCircle, Loader2 } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';

import { getGenerationStatusAction } from '../server/generation-status-actions';
import { GenerationStatusPanel } from './generation-status-panel';

interface GenerationStatusIndicatorProps {
  accountId: string;
  compact?: boolean;
}

export function GenerationStatusIndicator({
  accountId,
  compact = false,
}: GenerationStatusIndicatorProps) {
  const [open, setOpen] = useState(false);

  const { data: status } = useQuery({
    queryKey: ['generation-status', accountId],
    queryFn: () => getGenerationStatusAction({ accountId }),
    refetchInterval: (query) => {
      const hasActive = query.state.data?.jobs.some(
        (j) => j.status === 'processing',
      );
      return hasActive ? 2000 : 10000;
    },
  });

  const activeCount =
    status?.jobs.filter((j) => j.status === 'processing').length || 0;
  const queuedCount =
    status?.jobs.filter((j) => j.status === 'queued').length || 0;
  const hasActivity = activeCount > 0 || queuedCount > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {compact ? (
          <CompactIndicator
            activeCount={activeCount}
            queuedCount={queuedCount}
          />
        ) : (
          <Button variant="ghost" size="sm" className="relative">
            {hasActivity ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="ml-2">{activeCount} generating</span>
                {queuedCount > 0 && (
                  <Badge variant="secondary" className="ml-2 text-xs">
                    +{queuedCount}
                  </Badge>
                )}
              </>
            ) : (
              <>
                <CheckCircle className="text-muted-foreground h-4 w-4" />
                <span className="text-muted-foreground ml-2">
                  No active jobs
                </span>
              </>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end">
        <GenerationStatusPanel
          accountId={accountId}
          jobs={status?.jobs || []}
        />
      </PopoverContent>
    </Popover>
  );
}

interface CompactIndicatorProps {
  activeCount: number;
  queuedCount: number;
}

const CompactIndicator = forwardRef<HTMLButtonElement, CompactIndicatorProps>(
  function CompactIndicator({ activeCount, queuedCount, ...props }, ref) {
    const total = activeCount + queuedCount;

    if (total === 0) {
      return (
        <button
          ref={ref}
          {...props}
          className="text-muted-foreground flex items-center gap-2 text-sm"
        >
          <CheckCircle className="h-4 w-4" />
          <span>All complete</span>
        </button>
      );
    }

    return (
      <button
        ref={ref}
        {...props}
        className="hover:bg-accent flex w-full items-center gap-2 rounded-md p-2 text-sm"
      >
        <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
        <span>
          {activeCount} generating
          {queuedCount > 0 && `, ${queuedCount} queued`}
        </span>
      </button>
    );
  },
);
