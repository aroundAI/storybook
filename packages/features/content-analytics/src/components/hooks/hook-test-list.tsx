'use client';

import { Zap } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';

/** Row shape returned by listHookTestsAction. */
export interface HookTestEntry {
  id: string;
  name: string;
  topic: string;
  hypothesis: string | null;
  status: string;
  viral_threshold: number;
  created_at: string;
}

interface HookTestListProps {
  /** Tests to render, newest first */
  tests: HookTestEntry[];
  /** Opens a test's workbench */
  onSelect?: (testId: string) => void;
  /** Loading state */
  isLoading?: boolean;
}

/**
 * List of hook tests for a project or account.
 */
export function HookTestList({
  tests,
  onSelect,
  isLoading = false,
}: HookTestListProps) {
  if (isLoading) {
    return <HookTestListSkeleton />;
  }

  if (tests.length === 0) {
    return (
      <div className={'flex flex-col items-center gap-2 py-12 text-center'}>
        <Zap className={'text-muted-foreground h-8 w-8'} />
        <p className={'text-sm font-medium'}>No hook tests yet</p>
        <p className={'text-muted-foreground max-w-md text-sm'}>
          Test several openings for the same topic and compare how many viewers
          are still watching at three seconds.
        </p>
      </div>
    );
  }

  return (
    <div className={'flex flex-col gap-2'} data-test={'hook-test-list'}>
      {tests.map((test) => (
        <button
          key={test.id}
          type={'button'}
          onClick={() => onSelect?.(test.id)}
          className={
            'hover:bg-accent flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors'
          }
        >
          <div className={'flex items-start justify-between gap-3'}>
            <span className={'font-medium'}>{test.name}</span>
            <Badge variant={'outline'} className={'shrink-0'}>
              {test.status}
            </Badge>
          </div>

          <p className={'text-muted-foreground text-sm'}>{test.topic}</p>

          <p className={'text-muted-foreground text-xs'}>
            Threshold {Math.round(test.viral_threshold * 100)}% at 3s
          </p>
        </button>
      ))}
    </div>
  );
}

export function HookTestListSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className={'h-24 w-full rounded-lg'} />
      ))}
    </div>
  );
}
