'use client';

import { useRef, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

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
import { unwrap } from '@kit/content-analytics/lib/action-result';
import {
  type EditableExperiment,
  toFormValues,
  toUpdatePayload,
} from '@kit/content-analytics/lib/experiment-edit';
import {
  canAbandon,
  canConclude,
  canDelete,
  canStart,
} from '@kit/content-analytics/lib/experiment-transitions';
import { localToday } from '@kit/content-analytics/lib/local-date';
import {
  type ExperimentStatus,
  ExperimentStatusSchema,
} from '@kit/content-analytics/lib/schemas/experiment';
import { listChannelsAction } from '@kit/content-analytics/server/channels-actions';
import {
  abandonExperimentAction,
  concludeExperimentAction,
  createExperimentAction,
  deleteExperimentAction,
  getExperimentAction,
  listExperimentsAction,
  listExperimentsDueForReviewAction,
  listLinkablePublishesAction,
  startExperimentAction,
  updateExperimentAction,
} from '@kit/content-analytics/server/experiment-actions';
import { listTagsAction } from '@kit/content-analytics/server/taxonomy-actions';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

const ALL = 'all';

/** What the change dialog shows, and which confirmation is open. */
interface Panel {
  view: 'detail' | 'edit';
  confirm: 'abandon' | 'delete' | null;
  /** The optional reason typed into the abandon confirmation */
  reason: string;
}

const CLOSED_PANEL: Panel = { view: 'detail', confirm: null, reason: '' };

interface ExperimentsClientProps {
  /** Account whose experiment log is shown */
  accountId: string;
}

/**
 * Experiment log surface: create experiments, start them (capturing a
 * metric baseline), conclude them with the observed outcome, and — since
 * KB-7 — edit, abandon or delete them, filtered by status.
 */
export function ExperimentsClient({ accountId }: ExperimentsClientProps) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState('');
  const [panel, setPanel] = useState<Panel>(CLOSED_PANEL);

  // The status filter lives in the URL, so a reload or Back keeps it. An
  // unrecognised value is no filter, never an error.
  const parsedStatus = ExperimentStatusSchema.safeParse(
    searchParams.get('status'),
  );
  const statusFilter = parsedStatus.success ? parsedStatus.data : undefined;

  const setStatusFilter = (next: ExperimentStatus | undefined) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set('status', next);
    else params.delete('status');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  };
  // One state for the in-flight lifecycle action: `pending` disables every
  // lifecycle button so a double click cannot send it twice, and `error`
  // keeps a failure on screen after the toast has gone.
  const [action, setAction] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });
  // The guard itself is a ref: two clicks can land before React re-renders
  // the disabled button, and both would read `pending` as false.
  const inFlight = useRef(false);
  // The picker's search: what is typed shows at once; what is fetched waits
  // until typing pauses, so each keystroke is not a request.
  const [videoSearch, setVideoSearch] = useState({ typed: '', fetched: '' });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onVideoSearchChange = (typed: string) => {
    setVideoSearch((current) => ({ ...current, typed }));
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => setVideoSearch((current) => ({ ...current, fetched: typed })),
      250,
    );
  };

  const listQuery = useQuery({
    queryKey: ['experiments', accountId, statusFilter ?? ALL],
    queryFn: () =>
      listExperimentsAction({ accountId, status: statusFilter }),
  });

  const tagsQuery = useQuery({
    queryKey: ['experiment-tags', accountId],
    queryFn: () => listTagsAction({ accountId }),
  });

  const dueQuery = useQuery({
    queryKey: ['experiments-due', accountId],
    // The date is read when the fetch runs, not when the page rendered.
    // "Due" is a calendar question, and a tab left open past midnight
    // refetches on focus without re-rendering first — a date captured at
    // render would ask about yesterday again. (Putting the date in the query
    // key did not fix that: nothing re-renders to produce the new key.)
    queryFn: () =>
      listExperimentsDueForReviewAction({ accountId, asOf: localToday() }),
  });

  const channelsQuery = useQuery({
    queryKey: ['experiment-channels', accountId],
    queryFn: () => listChannelsAction({ accountId }),
  });

  const videosQuery = useQuery({
    queryKey: ['experiment-linkable-videos', accountId, videoSearch.fetched],
    queryFn: () =>
      listLinkablePublishesAction({ accountId, search: videoSearch.fetched }),
    // Keep the last results on screen while the next search loads.
    placeholderData: (previous) => previous,
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

  const closeDialog = () => {
    setSelectedId(null);
    setOutcome('');
    setPanel(CLOSED_PANEL);
    setAction({ pending: false, error: null });
  };

  /**
   * Runs a lifecycle action. These used to be awaited bare, so a thrown
   * action failed with nothing on screen and a second click sent it again.
   * `removed`: the change no longer exists, so the dialog closes instead of
   * reading it back.
   */
  const runAction = async (
    run: () => Promise<unknown>,
    success: string,
    { removed = false }: { removed?: boolean } = {},
  ) => {
    if (inFlight.current) return false;

    inFlight.current = true;
    setAction({ pending: true, error: null });

    try {
      await run();
      toast.success(success);
      setAction({ pending: false, error: null });
      setPanel(CLOSED_PANEL);

      if (removed) {
        closeDialog();
        await refresh();
      } else {
        await Promise.all([refresh(), detailQuery.refetch()]);
      }
      return true;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'The action did not complete';
      toast.error(message);
      setAction({ pending: false, error: message });
      return false;
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className={'flex flex-col gap-8'}>
      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Log a change</h3>
        <ExperimentForm
          accountId={accountId}
          channels={channelsQuery.data ?? []}
          channelsLoading={channelsQuery.isLoading}
          channelsError={channelsQuery.isError}
          videos={videosQuery.data?.videos ?? []}
          videosHaveMore={videosQuery.data?.hasMore ?? false}
          videoSearch={videoSearch.typed}
          onVideoSearchChange={onVideoSearchChange}
          videosLoading={videosQuery.isLoading}
          videosError={videosQuery.isError}
          tags={tagsQuery.data ?? []}
          tagsLoading={tagsQuery.isLoading}
          tagsError={tagsQuery.isError}
          onSubmit={async (values) => {
            await unwrap(createExperimentAction(values));
          }}
          onSuccess={refresh}
        />
      </section>

      <section className={'flex flex-col gap-3'}>
        <h3 className={'text-sm font-medium'}>Due for review</h3>

        {dueQuery.isLoading ? (
          <Skeleton className={'h-12 w-full rounded-lg'} />
        ) : dueQuery.isError ? (
          <p
            className={'text-sm text-muted-foreground'}
            data-test={'experiments-due-error'}
          >
            Changes due for review could not be loaded.
          </p>
        ) : (
          <ExperimentsDueList
            experiments={dueQuery.data ?? []}
            onSelect={setSelectedId}
          />
        )}
      </section>

      <section className={'flex flex-col gap-3'}>
        <div className={'flex flex-wrap items-center justify-between gap-2'}>
          <h3 className={'text-sm font-medium'}>Changes</h3>
          <div className={'flex items-center gap-2'}>
            <Label
              htmlFor={'experiment-status-filter'}
              className={'text-xs text-muted-foreground'}
            >
              Status
            </Label>
            <Select
              value={statusFilter ?? ALL}
              onValueChange={(next) =>
                setStatusFilter(next === ALL ? undefined : (next as ExperimentStatus))
              }
            >
              <SelectTrigger
                id={'experiment-status-filter'}
                className={'h-8 w-36'}
                data-test={'experiment-status-filter'}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL} data-test={'experiment-status-option-all'}>
                  All
                </SelectItem>
                {ExperimentStatusSchema.options.map((status) => (
                  <SelectItem
                    key={status}
                    value={status}
                    data-test={`experiment-status-option-${status}`}
                    className={'capitalize'}
                  >
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {listQuery.isLoading ? (
          <ExperimentListSkeleton />
        ) : listQuery.isError ? (
          // A failed read, not an empty log: the empty state would claim
          // that no experiments exist.
          <p
            className={'text-sm text-muted-foreground'}
            data-test={'experiment-list-error'}
          >
            Changes could not be loaded.
          </p>
        ) : (
          <ExperimentList
            experiments={(listQuery.data ?? []) as ExperimentListEntry[]}
            onSelect={setSelectedId}
            statusFilter={statusFilter}
            onClearFilter={() => setStatusFilter(undefined)}
          />
        )}
      </section>

      <Dialog
        open={Boolean(selectedId)}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
      >
        <DialogContent className={'max-h-[85vh] overflow-y-auto sm:max-w-2xl'}>
          <DialogHeader>
            <DialogTitle>Change</DialogTitle>
          </DialogHeader>

          {detailQuery.isLoading || !experiment ? (
            <ExperimentDetailSkeleton />
          ) : panel.view === 'edit' ? (
            <EditChange
              key={`${experiment.id}:${experiment.updated_at}`}
              experiment={experiment as unknown as EditableExperiment}
              channels={channelsQuery.data ?? []}
              channelsLoading={channelsQuery.isLoading}
              channelsError={channelsQuery.isError}
              videos={videosQuery.data?.videos ?? []}
              videosHaveMore={videosQuery.data?.hasMore ?? false}
              videoSearch={videoSearch.typed}
              onVideoSearchChange={onVideoSearchChange}
              videosLoading={videosQuery.isLoading}
              videosError={videosQuery.isError}
              tags={tagsQuery.data ?? []}
              tagsLoading={tagsQuery.isLoading}
              tagsError={tagsQuery.isError}
              onSaved={async () => {
                setPanel(CLOSED_PANEL);
                await Promise.all([refresh(), detailQuery.refetch()]);
              }}
              onCancel={() => setPanel(CLOSED_PANEL)}
            />
          ) : (
            <div className={'flex flex-col gap-6'}>
              <ExperimentDetail
                experiment={
                  experiment as unknown as Parameters<
                    typeof ExperimentDetail
                  >[0]['experiment']
                }
              />

              {action.error ? (
                <p
                  className={'text-sm text-destructive'}
                  role={'alert'}
                  data-test={'experiment-action-error'}
                >
                  {action.error}
                </p>
              ) : null}

              <div className={'flex flex-wrap gap-2'}>
                <Button
                  variant={'outline'}
                  size={'sm'}
                  disabled={action.pending}
                  onClick={() => setPanel({ ...CLOSED_PANEL, view: 'edit' })}
                  data-test={'experiment-edit'}
                >
                  Edit
                </Button>
                {canAbandon(experiment.status) ? (
                  <Button
                    variant={'outline'}
                    size={'sm'}
                    disabled={action.pending}
                    onClick={() =>
                      setPanel({ ...CLOSED_PANEL, confirm: 'abandon' })
                    }
                    data-test={'experiment-abandon'}
                  >
                    Abandon
                  </Button>
                ) : null}
                {/* Hidden, not disabled, where the table would refuse it:
                    a running change is abandoned first, and a concluded one
                    is the record (KB-7, owner decision). */}
                {canDelete(experiment.status) ? (
                  <Button
                    variant={'outline'}
                    size={'sm'}
                    disabled={action.pending}
                    onClick={() =>
                      setPanel({ ...CLOSED_PANEL, confirm: 'delete' })
                    }
                    data-test={'experiment-delete'}
                  >
                    Delete
                  </Button>
                ) : null}
              </div>

              {canStart(experiment.status) ? (
                <Button
                  disabled={action.pending}
                  onClick={() =>
                    runAction(
                      () =>
                        unwrap(
                          startExperimentAction({
                            experimentId: experiment.id,
                            startedAt: localToday(),
                          }),
                        ),
                      'Started — baseline captured',
                    )
                  }
                  className={'self-start'}
                >
                  Start
                </Button>
              ) : null}

              {canConclude(experiment.status) ? (
                <div className={'flex flex-col gap-2'}>
                  {/* A visible label: a placeholder is gone once typing
                      starts, and names nothing to a screen reader. */}
                  <Label htmlFor={'experiment-outcome'}>
                    What actually happened?
                  </Label>
                  <Input
                    id={'experiment-outcome'}
                    value={outcome}
                    onChange={(event) => setOutcome(event.target.value)}
                    placeholder={'e.g. CTR rose from 4.1% to 5.0%'}
                    data-test={'experiment-outcome'}
                  />
                  <div className={'flex gap-2'}>
                    {(['confirmed', 'rejected', 'inconclusive'] as const).map(
                      (status) => (
                        <Button
                          key={status}
                          variant={
                            status === 'confirmed' ? 'default' : 'outline'
                          }
                          disabled={
                            action.pending || outcome.trim().length === 0
                          }
                          onClick={async () => {
                            const concluded = await runAction(
                              () =>
                                unwrap(
                                  concludeExperimentAction({
                                    experimentId: experiment.id,
                                    actualOutcome: outcome,
                                    outcomeStatus: status,
                                    endedAt: localToday(),
                                  }),
                                ),
                              'Concluded',
                            );
                            // Kept on failure, so the outcome is not retyped.
                            if (concluded) setOutcome('');
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

      <AlertDialog
        open={Boolean(experiment) && panel.confirm === 'abandon'}
        onOpenChange={(open) => {
          if (!open) setPanel(CLOSED_PANEL);
        }}
      >
        <AlertDialogContent data-test={'experiment-abandon-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>Abandon this change?</AlertDialogTitle>
            <AlertDialogDescription>
              It stops here and stays in the log as abandoned, with no result.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={'flex flex-col gap-2'}>
            <Label htmlFor={'experiment-abandon-reason'}>Why (optional)</Label>
            <Textarea
              id={'experiment-abandon-reason'}
              rows={3}
              maxLength={2000}
              value={panel.reason}
              onChange={(event) =>
                setPanel((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              data-test={'experiment-abandon-reason'}
            />
          </div>
          {action.error ? (
            <p
              className={'text-sm text-destructive'}
              role={'alert'}
              data-test={'experiment-confirm-error'}
            >
              {action.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel data-test={'experiment-abandon-cancel'}>
              Keep it
            </AlertDialogCancel>
            <Button
              variant={'destructive'}
              disabled={action.pending || !experiment}
              data-test={'experiment-abandon-confirm'}
              onClick={() =>
                experiment &&
                runAction(
                  () =>
                    unwrap(
                      abandonExperimentAction({
                        experimentId: experiment.id,
                        reason: panel.reason.trim() || undefined,
                        endedAt: localToday(),
                      }),
                    ),
                  'Change abandoned',
                )
              }
            >
              Abandon
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(experiment) && panel.confirm === 'delete'}
        onOpenChange={(open) => {
          if (!open) setPanel(CLOSED_PANEL);
        }}
      >
        <AlertDialogContent data-test={'experiment-delete-dialog'}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this change?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the change and its links to videos and tags. It
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {action.error ? (
            <p
              className={'text-sm text-destructive'}
              role={'alert'}
              data-test={'experiment-confirm-error'}
            >
              {action.error}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel data-test={'experiment-delete-cancel'}>
              Keep it
            </AlertDialogCancel>
            <Button
              variant={'destructive'}
              disabled={action.pending || !experiment}
              data-test={'experiment-delete-confirm'}
              onClick={() =>
                experiment &&
                runAction(
                  () =>
                    unwrap(
                      deleteExperimentAction({ experimentId: experiment.id }),
                    ),
                  'Change deleted',
                  { removed: true },
                )
              }
            >
              Delete
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The edit form for one change. Mounted with a key per change (and per
 * saved version), so its values always come from the change being edited:
 * `useForm` reads its defaults once, on mount.
 */
function EditChange({
  experiment,
  onSaved,
  onCancel,
  ...pickers
}: Omit<
  Parameters<typeof ExperimentForm>[0],
  | 'accountId'
  | 'onSubmit'
  | 'onSuccess'
  | 'mode'
  | 'initialValues'
  | 'initialVideos'
  | 'status'
  | 'onCancel'
> & {
  experiment: EditableExperiment;
  onSaved: () => Promise<unknown>;
  onCancel: () => void;
}) {
  const initialValues = toFormValues(experiment);

  return (
    <ExperimentForm
      {...pickers}
      mode={'edit'}
      accountId={experiment.account_id}
      initialValues={initialValues}
      initialVideos={experiment.publishes.map((link) => ({
        id: link.publish_id,
        title: link.publishes?.title ?? null,
        platform: link.publishes?.platform ?? '',
        publishedAt: link.publishes?.published_at ?? null,
      }))}
      status={experiment.status}
      onSubmit={async (values) => {
        await unwrap(
          updateExperimentAction(
            toUpdatePayload(
              experiment.id,
              experiment.status,
              initialValues,
              values,
            ),
          ),
        );
      }}
      onSuccess={onSaved}
      onCancel={onCancel}
    />
  );
}
