'use client';

import { useState } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import type { ExperimentListEntry } from '@kit/content-analytics/components';
import {
  ExperimentDetail,
  ExperimentDetailSkeleton,
  ExperimentForm,
  ExperimentList,
  ExperimentListSkeleton,
  ExperimentsDueList,
} from '@kit/content-analytics/components';
import { listChannelsAction } from '@kit/content-analytics/server/channels-actions';
import {
  concludeExperimentAction,
  createExperimentAction,
  getExperimentAction,
  listExperimentsAction,
  listExperimentsDueForReviewAction,
  listLinkablePublishesAction,
  startExperimentAction,
} from '@kit/content-analytics/server/experiment-actions';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

interface ExperimentsClientProps {
  /** Account whose experiment log is shown */
  accountId: string;
}

/**
 * Experiment log surface: create experiments, start them (capturing a
 * metric baseline), and conclude them with the observed outcome.
 */
export function ExperimentsClient({ accountId }: ExperimentsClientProps) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');

  const listQuery = useQuery({
    queryKey: ['experiments', accountId],
    queryFn: () => listExperimentsAction({ accountId }),
  });

  const dueQuery = useQuery({
    queryKey: ['experiments-due', accountId],
    queryFn: () => listExperimentsDueForReviewAction({ accountId }),
  });

  const channelsQuery = useQuery({
    queryKey: ['experiment-channels', accountId],
    queryFn: () => listChannelsAction({ accountId }),
  });

  const videosQuery = useQuery({
    queryKey: ['experiment-linkable-videos', accountId],
    queryFn: () => listLinkablePublishesAction({ accountId }),
  });

  const detailQuery = useQuery({
    queryKey: ['experiment', selectedId],
    queryFn: () => getExperimentAction({ experimentId: selectedId! }),
    enabled: Boolean(selectedId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['experiments', accountId] }),
      queryClient.invalidateQueries({
        queryKey: ['experiments-due', accountId],
      }),
    ]);

  const experiment = detailQuery.data;

  return (
    <div className={'flex flex-col gap-8'}>
      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Log a new experiment</h3>
        <ExperimentForm
          accountId={accountId}
          channels={channelsQuery.data ?? []}
          channelsLoading={channelsQuery.isLoading}
          channelsError={channelsQuery.isError}
          videos={videosQuery.data ?? []}
          videosLoading={videosQuery.isLoading}
          videosError={videosQuery.isError}
          onSubmit={async (values) => {
            await createExperimentAction(values);
          }}
          onSuccess={refresh}
        />
      </section>

      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Due for review</h3>

        {dueQuery.isLoading ? (
          <Skeleton className={'h-12 w-full rounded-lg'} />
        ) : dueQuery.isError ? (
          <p className={'text-muted-foreground text-sm'}>
            Experiments due for review could not be loaded.
          </p>
        ) : (
          <ExperimentsDueList
            experiments={dueQuery.data ?? []}
            onSelect={setSelectedId}
          />
        )}
      </section>

      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Experiments</h3>

        {listQuery.isLoading ? (
          <ExperimentListSkeleton />
        ) : (
          <ExperimentList
            experiments={(listQuery.data ?? []) as ExperimentListEntry[]}
            onSelect={setSelectedId}
          />
        )}
      </section>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setOutcome('');
          }
        }}
      >
        <DialogContent className={'max-h-[85vh] overflow-y-auto sm:max-w-2xl'}>
          <DialogHeader>
            <DialogTitle>Experiment</DialogTitle>
          </DialogHeader>

          {detailQuery.isLoading || !experiment ? (
            <ExperimentDetailSkeleton />
          ) : (
            <div className={'flex flex-col gap-6'}>
              <ExperimentDetail
                experiment={
                  experiment as unknown as Parameters<
                    typeof ExperimentDetail
                  >[0]['experiment']
                }
              />

              {experiment.status === 'planned' ? (
                <Button
                  onClick={async () => {
                    await startExperimentAction({
                      experimentId: experiment.id,
                    });
                    toast.success('Experiment started — baseline captured');
                    await Promise.all([refresh(), detailQuery.refetch()]);
                  }}
                  className={'self-start'}
                >
                  Start experiment
                </Button>
              ) : null}

              {experiment.status === 'running' ? (
                <div className={'flex flex-col gap-2'}>
                  <Input
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                    placeholder={'What actually happened?'}
                  />
                  <div className={'flex gap-2'}>
                    {(['confirmed', 'rejected', 'inconclusive'] as const).map(
                      (status) => (
                        <Button
                          key={status}
                          variant={
                            status === 'confirmed' ? 'default' : 'outline'
                          }
                          disabled={outcome.trim().length === 0}
                          onClick={async () => {
                            await concludeExperimentAction({
                              experimentId: experiment.id,
                              actualOutcome: outcome,
                              outcomeStatus: status,
                            });
                            toast.success('Experiment concluded');
                            setOutcome('');
                            await Promise.all([
                              refresh(),
                              detailQuery.refetch(),
                            ]);
                          }}
                        >
                          {status}
                        </Button>
                      ),
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
