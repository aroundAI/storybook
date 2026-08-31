'use client';

import { FlaskConical } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Skeleton } from '@kit/ui/skeleton';

/** Row shape returned by listExperimentsAction. */
export interface ExperimentListEntry {
  id: string;
  title: string;
  hypothesis: string | null;
  status: string;
  outcome_status: string;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

interface ExperimentListProps {
  /** Experiments to render, newest first */
  experiments: ExperimentListEntry[];
  /** Opens an experiment's detail view */
  onSelect?: (experimentId: string) => void;
  /** Loading state */
  isLoading?: boolean;
}

const STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  planned: 'outline',
  running: 'default',
  concluded: 'secondary',
  abandoned: 'outline',
};

const OUTCOME_LABELS: Record<string, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  rejected: 'Rejected',
  inconclusive: 'Inconclusive',
};

/**
 * The experiment log. Studio records what the numbers did; this records
 * what you changed and what you expected, which is what makes the numbers
 * interpretable months later.
 */
export function ExperimentList({
  experiments,
  onSelect,
  isLoading = false,
}: ExperimentListProps) {
  if (isLoading) {
    return <ExperimentListSkeleton />;
  }

  if (experiments.length === 0) {
    return (
      <div className={'flex flex-col items-center gap-2 py-12 text-center'}>
        <FlaskConical className={'text-muted-foreground h-8 w-8'} />
        <p className={'text-sm font-medium'}>No experiments logged yet</p>
        <p className={'text-muted-foreground max-w-md text-sm'}>
          Record what you tried and what you expected. In six months the
          analytics alone will not tell you which changes caused what.
        </p>
      </div>
    );
  }

  return (
    <div className={'flex flex-col gap-2'} data-test={'experiment-list'}>
      {experiments.map((experiment) => (
        <button
          key={experiment.id}
          type={'button'}
          onClick={() => onSelect?.(experiment.id)}
          className={
            'hover:bg-accent flex flex-col gap-2 rounded-lg border p-4 text-left transition-colors'
          }
        >
          <div className={'flex items-start justify-between gap-3'}>
            <span className={'font-medium'}>{experiment.title}</span>

            <span className={'flex shrink-0 gap-1.5'}>
              <Badge variant={STATUS_VARIANTS[experiment.status] ?? 'outline'}>
                {experiment.status}
              </Badge>
              {experiment.status === 'concluded' ? (
                <Badge variant={'outline'}>
                  {OUTCOME_LABELS[experiment.outcome_status] ??
                    experiment.outcome_status}
                </Badge>
              ) : null}
            </span>
          </div>

          {experiment.hypothesis ? (
            <p className={'text-muted-foreground line-clamp-2 text-sm'}>
              {experiment.hypothesis}
            </p>
          ) : null}

          <p className={'text-muted-foreground text-xs'}>
            {experiment.started_at
              ? `Started ${experiment.started_at}`
              : `Created ${experiment.created_at.slice(0, 10)}`}
            {experiment.ended_at ? ` · Ended ${experiment.ended_at}` : ''}
          </p>
        </button>
      ))}
    </div>
  );
}

export function ExperimentListSkeleton() {
  return (
    <div className={'flex flex-col gap-2'}>
      {Array.from({ length: 3 }).map((_, index) => (
        <Skeleton key={index} className={'h-24 w-full rounded-lg'} />
      ))}
    </div>
  );
}
