'use client';

import { useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';

import { FORMAT_FAMILY_LABEL, type FormatFamily } from '@kit/clickhouse';
import {
  refusalMessage,
  unwrap,
} from '@kit/content-analytics/lib/action-result';
import { localDateOf, localToday } from '@kit/content-analytics/lib/local-date';
import { AssignExperimentVideoSchema } from '@kit/content-analytics/lib/schemas/channel-experiment';
import {
  abandonChannelExperimentAction,
  addExperimentStyleAction,
  assignExperimentVideoAction,
  concludeChannelExperimentAction,
  deleteChannelExperimentAction,
  getChannelExperimentAction,
  listAssignableVideosAction,
  removeExperimentStyleAction,
  startChannelExperimentAction,
  unassignExperimentVideoAction,
} from '@kit/content-analytics/server/channel-experiment-actions';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
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

import { ChannelExperimentResultsView } from './channel-experiment-results';

/** A video leaves an experiment only before its first checkpoint (the table's rule). */
const FIRST_CHECKPOINT_DAYS = 7;

/** One lifecycle action at a time: a ref, because two clicks can land before a re-render. */
function useInFlight() {
  const inFlight = useRef(false);
  const [state, setState] = useState<{
    pending: boolean;
    error: string | null;
  }>({ pending: false, error: null });

  const run = async (
    action: () => Promise<unknown>,
    success: string,
    after: () => Promise<unknown>,
  ) => {
    if (inFlight.current) return false;
    inFlight.current = true;
    setState({ pending: true, error: null });

    try {
      await action();
      toast.success(success);
      setState({ pending: false, error: null });
      await after();
      return true;
    } catch (error) {
      const message = refusalMessage(error, 'It did not complete. Try again.');
      toast.error(message);
      setState({ pending: false, error: message });
      await after();
      return false;
    } finally {
      inFlight.current = false;
    }
  };

  return { ...state, run };
}

type Detail = Awaited<ReturnType<typeof loadDetail>>;

function loadDetail(experimentId: string) {
  return unwrap(getChannelExperimentAction({ experimentId }));
}

export function ChannelExperimentDetail(props: {
  experimentId: string;
  channelName: (connectionId: string) => string;
  onChanged: () => Promise<unknown>;
  onRemoved: () => Promise<unknown>;
}) {
  const { experimentId } = props;
  const action = useInFlight();
  const [conclusion, setConclusion] = useState('');

  const detail = useQuery({
    queryKey: ['channel-experiment', experimentId],
    queryFn: () => loadDetail(experimentId),
  });

  const running = detail.data?.experiment.status === 'running';

  const assignable = useQuery({
    queryKey: ['channel-experiment-assignable', experimentId],
    queryFn: () => unwrap(listAssignableVideosAction({ experimentId })),
    enabled: running,
  });

  const refresh = () =>
    Promise.all([
      detail.refetch(),
      running ? assignable.refetch() : null,
      props.onChanged(),
    ]);

  if (detail.isLoading) {
    return (
      <Skeleton className={'h-64 w-full'} data-test={'ce-detail-loading'} />
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <p className={'text-sm text-destructive'} data-test={'ce-detail-error'}>
        {refusalMessage(detail.error, 'The experiment could not be loaded.')}
      </p>
    );
  }

  const data = detail.data;
  const { experiment, styles } = data;
  const status = experiment.status;
  const open = status === 'planned' || status === 'running';
  const styleName = new Map(styles.map((style) => [style.id, style.name]));

  return (
    <section
      className={'flex flex-col gap-6 rounded-lg border p-4'}
      data-test={'ce-detail'}
      data-status={status}
    >
      <header className={'flex flex-col gap-1'}>
        <div className={'flex flex-wrap items-center gap-2'}>
          <h3 className={'text-lg font-semibold'}>{experiment.title}</h3>
          <Badge data-test={'ce-status'}>{status}</Badge>
        </div>
        <p className={'text-sm text-muted-foreground'}>
          {props.channelName(experiment.connection_id)} ·{' '}
          {FORMAT_FAMILY_LABEL[experiment.format_family as FormatFamily] ??
            experiment.format_family}
          {experiment.started_at ? ` · started ${experiment.started_at}` : ''}
          {experiment.ended_at ? ` · ended ${experiment.ended_at}` : ''}
        </p>
        <dl className={'mt-2 grid gap-2 text-sm sm:grid-cols-2'}>
          <div>
            <dt className={'text-muted-foreground'}>Hypothesis</dt>
            <dd>{experiment.hypothesis ?? 'Not recorded'}</dd>
          </div>
          <div>
            <dt className={'text-muted-foreground'}>Expected</dt>
            <dd>{experiment.expected_outcome ?? 'Not recorded'}</dd>
          </div>
          {experiment.conclusion ? (
            <div className={'sm:col-span-2'}>
              <dt className={'text-muted-foreground'}>
                Concluded ({experiment.outcome_status})
              </dt>
              <dd data-test={'ce-conclusion'}>{experiment.conclusion}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      {action.error ? (
        <p
          className={'text-sm text-destructive'}
          role={'alert'}
          data-test={'ce-action-error'}
        >
          {action.error}
        </p>
      ) : null}

      <StylesSection
        data={data}
        open={open}
        pending={action.pending}
        onAdd={(name) =>
          action.run(
            () => unwrap(addExperimentStyleAction({ experimentId, name })),
            'Style added',
            refresh,
          )
        }
        onRemove={(styleId) =>
          action.run(
            () =>
              unwrap(removeExperimentStyleAction({ experimentId, styleId })),
            'Style removed',
            refresh,
          )
        }
      />

      {running ? (
        <AssignVideoForm
          // A new suggestion after every assignment: remount, so the style
          // select shows it rather than the last choice (FILM-1609).
          key={`${data.suggestedStyleId}:${data.videos.length}`}
          experimentId={experimentId}
          styles={styles}
          suggestedStyleId={data.suggestedStyleId}
          videos={assignable.data ?? []}
          videosLoading={assignable.isLoading}
          onAssigned={refresh}
        />
      ) : null}

      <section className={'flex flex-col gap-2'}>
        <h4 className={'text-sm font-medium'}>Videos ({data.videos.length})</h4>
        {data.videos.length === 0 ? (
          <p
            className={'text-sm text-muted-foreground'}
            data-test={'ce-videos-empty'}
          >
            No videos assigned yet.
          </p>
        ) : (
          <ul
            className={'flex flex-col divide-y rounded-md border text-sm'}
            data-test={'ce-videos'}
          >
            {data.videos.map((video) => {
              const young =
                Date.now() - Date.parse(video.publishedAt) <
                FIRST_CHECKPOINT_DAYS * 86_400_000;

              return (
                <li
                  key={video.publishId}
                  className={
                    'flex flex-wrap items-center justify-between gap-2 p-2'
                  }
                  data-test={`ce-video-${video.publishId}`}
                >
                  <span>
                    {video.title ?? 'Untitled'}{' '}
                    <span className={'text-muted-foreground'}>
                      · {localDateOf(video.publishedAt)} ·{' '}
                      <span data-test={`ce-video-style-${video.publishId}`}>
                        {styleName.get(video.styleId)}
                      </span>
                    </span>{' '}
                    {video.overridden ? (
                      <Badge
                        variant={'outline'}
                        data-test={`ce-video-overridden-${video.publishId}`}
                        title={`Suggested: ${styleName.get(video.suggestedStyleId ?? '') ?? 'a style since removed'}`}
                      >
                        chosen over the suggestion
                      </Badge>
                    ) : null}
                  </span>
                  {running && young ? (
                    <Button
                      variant={'ghost'}
                      size={'sm'}
                      disabled={action.pending}
                      onClick={() =>
                        action.run(
                          () =>
                            unwrap(
                              unassignExperimentVideoAction({
                                experimentId,
                                publishId: video.publishId,
                              }),
                            ),
                          'Video removed',
                          refresh,
                        )
                      }
                      data-test={`ce-video-remove-${video.publishId}`}
                    >
                      Remove
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className={'flex flex-col gap-2'}>
        <h4 className={'text-sm font-medium'}>Results</h4>
        <ChannelExperimentResultsView
          state={data.results}
          evidence={data.evidence}
        />
      </section>

      <section className={'flex flex-col gap-3 border-t pt-4'}>
        {status === 'planned' ? (
          <Button
            className={'self-start'}
            disabled={action.pending}
            onClick={() =>
              action.run(
                () =>
                  unwrap(
                    startChannelExperimentAction({
                      experimentId,
                      startedAt: localToday(),
                    }),
                  ),
                'Experiment started',
                refresh,
              )
            }
            data-test={'ce-start'}
          >
            Start: assign new uploads from today
          </Button>
        ) : null}

        {running ? (
          <div className={'flex flex-col gap-2'}>
            <Label htmlFor={'ce-conclusion-input'}>
              What did you conclude?
            </Label>
            <Textarea
              id={'ce-conclusion-input'}
              rows={2}
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
              data-test={'ce-conclusion-input'}
            />
            <div className={'flex flex-wrap gap-2'}>
              {(['confirmed', 'rejected', 'inconclusive'] as const).map(
                (outcome) => (
                  <Button
                    key={outcome}
                    variant={outcome === 'confirmed' ? 'default' : 'outline'}
                    disabled={action.pending || !conclusion.trim()}
                    onClick={async () => {
                      const done = await action.run(
                        () =>
                          unwrap(
                            concludeChannelExperimentAction({
                              experimentId,
                              conclusion,
                              outcomeStatus: outcome,
                              endedAt: localToday(),
                            }),
                          ),
                        'Experiment concluded',
                        refresh,
                      );
                      if (done) setConclusion('');
                    }}
                    data-test={`ce-conclude-${outcome}`}
                  >
                    Conclude: {outcome}
                  </Button>
                ),
              )}
            </div>
            <p className={'text-xs text-muted-foreground'}>
              Concluding freezes the results as they stand now.
            </p>
          </div>
        ) : null}

        <div className={'flex flex-wrap gap-2'}>
          {open ? (
            <Button
              variant={'outline'}
              size={'sm'}
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () =>
                    unwrap(
                      abandonChannelExperimentAction({
                        experimentId,
                        endedAt: localToday(),
                      }),
                    ),
                  'Experiment abandoned',
                  refresh,
                )
              }
              data-test={'ce-abandon'}
            >
              Abandon
            </Button>
          ) : null}
          {status === 'planned' || status === 'abandoned' ? (
            <Button
              variant={'outline'}
              size={'sm'}
              disabled={action.pending}
              onClick={() =>
                action.run(
                  () => unwrap(deleteChannelExperimentAction({ experimentId })),
                  'Experiment deleted',
                  props.onRemoved,
                )
              }
              data-test={'ce-delete'}
            >
              Delete
            </Button>
          ) : null}
        </div>
      </section>
    </section>
  );
}

function StylesSection(props: {
  data: Detail;
  open: boolean;
  pending: boolean;
  onAdd: (name: string) => Promise<boolean>;
  onRemove: (styleId: string) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const { styles } = props.data;

  return (
    <section className={'flex flex-col gap-2'}>
      <h4 className={'text-sm font-medium'}>Styles</h4>
      <ul className={'flex flex-wrap gap-2'} data-test={'ce-styles'}>
        {styles.map((style) => (
          <li
            key={style.id}
            className={
              'flex items-center gap-1 rounded-md border px-2 py-1 text-sm'
            }
            data-test={`ce-style-${style.id}`}
          >
            {style.name}
            <span
              className={'text-muted-foreground'}
              data-test={`ce-style-count-${style.id}`}
            >
              ({style.videoCount})
            </span>
            {props.open && style.videoCount === 0 && styles.length > 2 ? (
              <Button
                variant={'ghost'}
                size={'sm'}
                className={'h-6 px-1'}
                disabled={props.pending}
                onClick={() => props.onRemove(style.id)}
                aria-label={`Remove ${style.name}`}
                data-test={`ce-style-delete-${style.id}`}
              >
                ×
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {props.open && styles.length < 8 ? (
        <form
          className={'flex gap-2'}
          onSubmit={async (event) => {
            event.preventDefault();
            if (await props.onAdd(name)) setName('');
          }}
        >
          <Input
            aria-label={'New style'}
            placeholder={'Add a style'}
            className={'max-w-xs'}
            value={name}
            onChange={(event) => setName(event.target.value)}
            data-test={'ce-add-style-name'}
          />
          <Button
            type={'submit'}
            variant={'outline'}
            disabled={props.pending || !name.trim()}
            data-test={'ce-add-style'}
          >
            Add
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Assigns one new upload to a style. The style starts at the table's own
 * suggestion — the style with the fewest videos so far — so the groups stay
 * balanced; choosing another is allowed and recorded as an override.
 */
function AssignVideoForm(props: {
  experimentId: string;
  styles: { id: string; name: string; videoCount: number }[];
  suggestedStyleId: string | null;
  videos: { id: string; title: string | null; publishedAt: string }[];
  videosLoading: boolean;
  onAssigned: () => Promise<unknown>;
}) {
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(AssignExperimentVideoSchema),
    defaultValues: {
      experimentId: props.experimentId,
      publishId: '',
      styleId: props.suggestedStyleId ?? '',
    },
  });

  const chosen = form.watch('styleId');
  const suggested = props.styles.find(
    (style) => style.id === props.suggestedStyleId,
  );

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);

    try {
      const result = await unwrap(assignExperimentVideoAction(values));
      toast.success(
        result.overridden
          ? 'Assigned — recorded as chosen over the suggestion'
          : 'Assigned to the suggested style',
      );
      await props.onAssigned();
    } catch (failure) {
      const message = refusalMessage(
        failure,
        'It was not assigned. Try again.',
      );
      setError(message);
      toast.error(message);
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className={'flex flex-col gap-3 rounded-md border p-3'}
        data-test={'ce-assign-form'}
        noValidate
      >
        <h4 className={'text-sm font-medium'}>Assign a new upload</h4>
        <div className={'grid gap-3 sm:grid-cols-2'}>
          <FormField
            control={form.control}
            name={'publishId'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Video</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                  disabled={props.videosLoading}
                >
                  <FormControl>
                    <SelectTrigger data-test={'ce-assign-video'}>
                      <SelectValue
                        placeholder={
                          props.videosLoading
                            ? 'Loading videos…'
                            : props.videos.length === 0
                              ? 'No new uploads to assign'
                              : 'Choose a video'
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {props.videos.map((video) => (
                      <SelectItem
                        key={video.id}
                        value={video.id}
                        data-test={`ce-assign-video-option-${video.id}`}
                      >
                        {video.title ?? 'Untitled'} ·{' '}
                        {localDateOf(video.publishedAt)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={'styleId'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Style</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger data-test={'ce-assign-style'}>
                      <SelectValue placeholder={'Choose a style'} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {props.styles.map((style) => (
                      <SelectItem
                        key={style.id}
                        value={style.id}
                        data-test={`ce-assign-style-option-${style.id}`}
                      >
                        {style.name} ({style.videoCount})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {suggested ? (
          <p
            className={'text-xs text-muted-foreground'}
            data-test={'ce-suggestion'}
          >
            Suggested: {suggested.name}, which has the fewest videos so far.
            {chosen && chosen !== suggested.id ? (
              <span data-test={'ce-override-note'}>
                {' '}
                You are choosing another style; that is recorded.
              </span>
            ) : null}
          </p>
        ) : null}
        {error ? (
          <p
            className={'text-sm text-destructive'}
            role={'alert'}
            data-test={'ce-assign-error'}
          >
            {error}
          </p>
        ) : null}
        <Button
          type={'submit'}
          className={'self-start'}
          disabled={form.formState.isSubmitting}
          data-test={'ce-assign-submit'}
        >
          Assign
        </Button>
      </form>
    </Form>
  );
}
