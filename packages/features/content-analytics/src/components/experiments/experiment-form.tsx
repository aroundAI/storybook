'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import { frozenFields } from '../../lib/experiment-transitions';
import {
  BAKED_IN_CATEGORIES,
  BAKED_IN_NOTE,
  CreateExperimentSchema,
  DEFAULT_REVIEW_WINDOW_DAYS,
  EXPERIMENT_CATEGORY_LABELS,
  ExperimentCategorySchema,
} from '../../lib/schemas/experiment.schema';
import {
  WATCHED_METRICS,
  WATCHED_METRIC_KEYS,
  WATCHED_METRIC_NOTES,
} from '../../lib/watched-metrics';
import type { ChannelRef } from '../../server/channels';
import { ChannelFilter } from '../deep-dive/channel-filter';
import type { ContentTag } from '../taxonomy/tag-manager';
import { TagPicker } from '../taxonomy/tag-picker';
import { type LinkableVideo, VideoPicker } from './video-picker';

type CreateExperimentValues = z.infer<typeof CreateExperimentSchema>;

/** Said beside every field a started change can no longer change. */
export const FROZEN_NOTE =
  'Fixed once the change started: the baseline was measured over the metric, window and videos, and the hypothesis and expectation were recorded before the result.';

/** The schema caps linked videos at this; the picker enforces the same. */
const MAX_LINKED_VIDEOS = 200;

/**
 * Radix `Select` cannot hold an empty-string value, so "none" needs a token.
 * It never reaches form state: the field holds `undefined` instead.
 */
const NONE = 'none';

interface ExperimentFormProps {
  /** Account the experiment belongs to */
  accountId: string;
  /** Optional project scope */
  projectId?: string;
  /** The account's channels, for the optional channel field */
  channels: ChannelRef[];
  channelsLoading?: boolean;
  channelsError?: boolean;
  /** The current title search's videos, for linking (at most one page) */
  videos: LinkableVideo[];
  videosHaveMore: boolean;
  videoSearch: string;
  onVideoSearchChange: (search: string) => void;
  videosLoading?: boolean;
  videosError?: boolean;
  /** The account's tag vocabulary, for linking tags */
  tags: ContentTag[];
  tagsLoading?: boolean;
  tagsError?: boolean;
  /** Persists the experiment */
  onSubmit: (values: CreateExperimentValues) => Promise<void>;
  /** Called after a successful save */
  onSuccess?: () => void;
  /**
   * `edit` fills the form from a stored change (KB-7). The parent mounts a
   * fresh form per change (a `key`), so one change's values can never be
   * shown, or saved, as another's.
   */
  mode?: 'create' | 'edit';
  initialValues?: CreateExperimentValues;
  /** The change's linked videos, so they show as selected (edit) */
  initialVideos?: LinkableVideo[];
  /** The change's status (edit): decides which fields are locked */
  status?: string;
  onCancel?: () => void;
}

/**
 * Every field's empty value, in one place.
 *
 * Used for both `defaultValues` and `reset()`. Two copies drift, and a field
 * missing from the reset keeps its old value in form state while the screen
 * shows it cleared — or the other way round — which is how the FILM-1609
 * form saved rows nobody typed.
 */
function emptyValues(accountId: string, projectId?: string) {
  return {
    accountId,
    projectId,
    title: '',
    hypothesis: '',
    changeDescription: '',
    expectedOutcome: '',
    category: undefined,
    metricWatched: undefined,
    reviewWindowDays: DEFAULT_REVIEW_WINDOW_DAYS,
    notes: '',
    connectionId: undefined,
    publishIds: [],
    tagIds: [],
  };
}

/**
 * Captures an experiment before it runs: what is changing, why, and what
 * result is expected. Recording the expectation up front is what makes the
 * eventual outcome informative rather than a post-hoc story.
 *
 * Every select here is controlled (`value`, not `defaultValue`): Radix keeps
 * an uncontrolled select's label across `reset()`, so the screen would show
 * the last experiment's metric while form state held none.
 */
export function ExperimentForm({
  accountId,
  projectId,
  channels,
  channelsLoading = false,
  channelsError = false,
  videos,
  videosHaveMore,
  videoSearch,
  onVideoSearchChange,
  videosLoading = false,
  videosError = false,
  tags,
  tagsLoading = false,
  tagsError = false,
  onSubmit,
  onSuccess,
  mode = 'create',
  initialValues,
  initialVideos,
  status = 'planned',
  onCancel,
}: ExperimentFormProps) {
  const editing = mode === 'edit';
  const form = useForm({
    resolver: zodResolver(CreateExperimentSchema),
    defaultValues: initialValues ?? emptyValues(accountId, projectId),
  });

  const isSubmitting = form.formState.isSubmitting;
  // The same list the action refuses and the table freezes: one rule.
  const locked = frozenFields(editing ? status : 'planned');
  const isLocked = (field: string) => locked.includes(field);

  // A refusal stays on screen after its toast has gone.
  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSubmit = form.handleSubmit(async (values) => {
    setSaveError(null);
    try {
      await onSubmit(values);
      toast.success(editing ? 'Change saved' : 'Change logged');
      if (!editing) form.reset(emptyValues(accountId, projectId));
      onSuccess?.();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save the change';
      setSaveError(message);
      toast.error(message);
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={handleSubmit}
        className={'flex flex-col gap-4'}
        data-test={editing ? 'experiment-edit-form' : 'experiment-form'}
      >
        {locked.length > 0 ? (
          <p
            id={'experiment-frozen-note'}
            className={'rounded-md border p-3 text-xs text-muted-foreground'}
            data-test={'experiment-frozen-note'}
          >
            {FROZEN_NOTE}
          </p>
        ) : null}

        <FormField
          control={form.control}
          name={'title'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  placeholder={'e.g. Faces on thumbnails'}
                  data-test={'experiment-title'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'changeDescription'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>What are you changing?</FormLabel>
              <FormControl>
                <Textarea
                  rows={3}
                  placeholder={
                    'New thumbnails on these five videos: a face instead of text'
                  }
                  data-test={'experiment-change'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className={'grid gap-4 sm:grid-cols-2'}>
          <FormField
            control={form.control}
            name={'category'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category (optional)</FormLabel>
                <Select
                  value={field.value ?? NONE}
                  onValueChange={(next) =>
                    field.onChange(next === NONE ? undefined : next)
                  }
                >
                  <FormControl>
                    <SelectTrigger data-test={'experiment-category'}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>No category</SelectItem>
                    {ExperimentCategorySchema.options.map((category) => (
                      <SelectItem
                        key={category}
                        value={category}
                        data-test={`experiment-category-option-${category}`}
                      >
                        {EXPERIMENT_CATEGORY_LABELS[category]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.value && BAKED_IN_CATEGORIES.has(field.value) ? (
                  <p
                    className={'text-xs text-muted-foreground'}
                    data-test={'experiment-category-note'}
                  >
                    {BAKED_IN_NOTE}
                  </p>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={'metricWatched'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Metric you are watching (optional)</FormLabel>
                <Select
                  disabled={isLocked('metricWatched')}
                  value={field.value ?? NONE}
                  onValueChange={(next) =>
                    field.onChange(next === NONE ? undefined : next)
                  }
                >
                  <FormControl>
                    <SelectTrigger
                      data-test={'experiment-metric'}
                      aria-describedby={
                        isLocked('metricWatched')
                          ? 'experiment-frozen-note'
                          : undefined
                      }
                    >
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value={NONE}>No specific metric</SelectItem>
                    {WATCHED_METRIC_KEYS.map((metric) => (
                      <SelectItem
                        key={metric}
                        value={metric}
                        data-test={`experiment-metric-option-${metric}`}
                      >
                        {WATCHED_METRICS[metric].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Measured on the linked videos only, before and after the
                  start.
                </FormDescription>
                {field.value && WATCHED_METRIC_NOTES[field.value] ? (
                  <p
                    className={'text-xs text-muted-foreground'}
                    data-test={'experiment-metric-note'}
                  >
                    {WATCHED_METRIC_NOTES[field.value]}
                  </p>
                ) : null}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name={'publishIds'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Videos you changed</FormLabel>
              {/* FormControl ties the label and error message to the
                  picker's trigger (it forwards id and aria attributes). */}
              <FormControl>
                <VideoPicker
                  disabled={isLocked('publishIds')}
                  initialVideos={initialVideos}
                  videos={videos}
                  hasMore={videosHaveMore}
                  search={videoSearch}
                  onSearchChange={onVideoSearchChange}
                  value={field.value ?? []}
                  onChange={field.onChange}
                  max={MAX_LINKED_VIDEOS}
                  isLoading={videosLoading}
                  isError={videosError}
                />
              </FormControl>
              <FormDescription>
                Published videos only. Each is compared with its own past: the
                days before the start against the days since.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className={'grid gap-4 sm:grid-cols-2'}>
          <FormField
            control={form.control}
            name={'connectionId'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Channel (optional)</FormLabel>
                <div data-test={'experiment-channel'}>
                  <FormControl>
                    <ChannelFilter
                      channels={channels}
                      value={field.value}
                      onChange={field.onChange}
                      isLoading={channelsLoading}
                      isError={channelsError}
                      allLabel={'No specific channel'}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={'reviewWindowDays'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Review after (days)</FormLabel>
                <FormControl>
                  <Input
                    type={'number'}
                    inputMode={'numeric'}
                    min={1}
                    max={365}
                    disabled={isLocked('reviewWindowDays')}
                    data-test={'experiment-review-window'}
                    name={field.name}
                    ref={field.ref}
                    onBlur={field.onBlur}
                    // A cleared field is NaN, which the schema refuses. It
                    // must not fall back to the default: a blank that
                    // silently saves 60 is a value nobody entered.
                    value={Number.isNaN(field.value) ? '' : field.value}
                    onChange={(event) =>
                      field.onChange(
                        event.target.value === ''
                          ? Number.NaN
                          : Number(event.target.value),
                      )
                    }
                  />
                </FormControl>
                <FormDescription>
                  The baseline covers the same number of days before the start.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name={'hypothesis'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hypothesis (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  placeholder={
                    'A face gets more clicks than text on these videos'
                  }
                  disabled={isLocked('hypothesis')}
                  data-test={'experiment-hypothesis'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'expectedOutcome'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>What do you expect to happen? (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  placeholder={'Click-through rate up by a point; views follow'}
                  disabled={isLocked('expectedOutcome')}
                  data-test={'experiment-expected'}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Recorded before the result is known, so hindsight cannot rewrite
                it.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'notes'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Notes (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} data-test={'experiment-notes'} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'tagIds'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Tags (optional)</FormLabel>
              <div data-test={'experiment-tags'}>
                <FormControl>
                  <TagPicker
                    tags={tags}
                    selectedTagIds={field.value ?? []}
                    onChange={field.onChange}
                    isLoading={tagsLoading}
                    isError={tagsError}
                    emptyText={
                      'No tags yet. Create them on the Tags page, then link them here.'
                    }
                  />
                </FormControl>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {saveError ? (
          <p
            className={'text-sm text-destructive'}
            role={'alert'}
            data-test={'experiment-form-error'}
          >
            {saveError}
          </p>
        ) : null}

        <div className={'flex flex-wrap gap-2'}>
          <Button
            type={'submit'}
            // An edit that changes nothing has nothing to save.
            disabled={isSubmitting || (editing && !form.formState.isDirty)}
            data-test={editing ? 'experiment-edit-save' : 'experiment-submit'}
          >
            {isSubmitting ? (
              <Loader2 className={'mr-2 h-4 w-4 animate-spin'} />
            ) : null}
            {editing ? 'Save' : 'Log change'}
          </Button>
          {onCancel ? (
            <Button
              type={'button'}
              variant={'outline'}
              onClick={onCancel}
              disabled={isSubmitting}
              data-test={'experiment-edit-cancel'}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  );
}
