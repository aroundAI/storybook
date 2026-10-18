'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { format } from 'date-fns';
import {
  AlertTriangle,
  ArrowRight,
  Film,
  Loader2,
  Smartphone,
  Zap,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { ActionResult } from '@kit/next/action-result';
import { Badge } from '@kit/ui/badge';
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
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';

import {
  type BreakingPreview,
  itemKeyOfTarget,
} from '../lib/cadence/release-types';
import {
  BreakingFormSchema,
  type BreakingFormValues,
} from '../lib/schemas/schedule-release.schema';

/** FILM-2210: what the Breaking news tab hands the Publish screen */
export interface BreakingSettings {
  /** Null: the next scheduler run */
  at: Date | null;
  extraPerDay: number;
  days: number;
}

type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; preview: BreakingPreview; forValues: string }
  | { status: 'error'; error: string };

const when = (iso: string) => format(new Date(iso), 'EEE d MMM, HH:mm');

function settingsOf(values: BreakingFormValues): BreakingSettings {
  return {
    at: values.when === 'at' ? new Date(values.at) : null,
    extraPerDay: values.extraPerDay,
    days: values.days,
  };
}

/**
 * FILM-2210. The Publish screen's Breaking news tab: when the long video
 * goes, how many extra Shorts a day and for how long, then a preview of
 * the breaking posts, every scheduled Short that moves back and any
 * YouTube upload-budget warning. Scheduling needs a preview of the values
 * as they stand.
 */
export function BreakingReleaseForm(props: {
  disabled: boolean;
  /** KB-198: the project's channels are still being read */
  channelsLoading: boolean;
  isScheduling: boolean;
  /** The schedule item a target came from, by its item key */
  labelOf: (itemKey: string) => { label: string; full: boolean };
  onPreview: (
    settings: BreakingSettings,
  ) => Promise<ActionResult<BreakingPreview>>;
  onSchedule: (settings: BreakingSettings) => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' });

  const form = useForm({
    resolver: zodResolver(BreakingFormSchema),
    defaultValues: {
      when: 'now' as BreakingFormValues['when'],
      at: '',
      extraPerDay: 2,
      days: 3,
    },
  });

  const values = JSON.stringify(form.watch());
  const previewed = preview.status === 'ready' && preview.forValues === values;

  const onPreview = form.handleSubmit(async (formValues) => {
    setPreview({ status: 'loading' });

    try {
      const result = await props.onPreview(settingsOf(formValues));

      setPreview(
        result.ok
          ? {
              status: 'ready',
              preview: result.data,
              forValues: JSON.stringify(formValues),
            }
          : { status: 'error', error: result.error },
      );
    } catch {
      setPreview({
        status: 'error',
        error: 'Could not read the channels’ calendars. Try again.',
      });
    }
  });

  // A schedule spends its preview: another needs a fresh one
  const onSchedule = form.handleSubmit((formValues) => {
    props.onSchedule(settingsOf(formValues));
    setPreview({ status: 'idle' });
  });

  return (
    <Form {...form}>
      <form
        className="space-y-4"
        data-test="breaking-release-form"
        onSubmit={(event) => {
          event.preventDefault();
          void onPreview();
        }}
      >
        <FormField
          control={form.control}
          name="when"
          render={({ field }) => (
            <FormItem>
              <FormLabel>When</FormLabel>
              <FormControl>
                <RadioGroup
                  value={field.value}
                  onValueChange={field.onChange}
                  className="flex gap-4"
                >
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="now" data-test="breaking-when-now" />
                    Now
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <RadioGroupItem value="at" data-test="breaking-when-at" />
                    At a time
                  </label>
                </RadioGroup>
              </FormControl>
              <FormDescription>
                Now: the next scheduler run, about 5 minutes away. Long videos
                already scheduled keep their times.
              </FormDescription>
            </FormItem>
          )}
        />

        {form.watch('when') === 'at' && (
          <FormField
            control={form.control}
            name="at"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date and time</FormLabel>
                <FormControl>
                  <Input
                    type="datetime-local"
                    data-test="breaking-at"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="extraPerDay"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Extra Shorts a day</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={0}
                    max={4}
                    data-test="breaking-extra-per-day"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="days"
            render={({ field }) => (
              <FormItem>
                <FormLabel>For (days)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    max={7}
                    data-test="breaking-days"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Its Shorts go to the front of each channel&apos;s Shorts queue from an
          hour after the long video. Only they use the extra times; the Shorts
          already queued move back in order.
        </p>

        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="w-full"
          data-test="breaking-preview"
          data-loading={props.channelsLoading || undefined}
          aria-busy={props.channelsLoading}
          disabled={
            props.disabled ||
            props.channelsLoading ||
            preview.status === 'loading'
          }
        >
          {(props.channelsLoading || preview.status === 'loading') && (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          )}
          {props.channelsLoading
            ? 'Loading channels…'
            : previewed
              ? 'Preview again'
              : 'Preview breaking release'}
        </Button>

        {preview.status === 'error' && (
          <p
            className="text-sm text-destructive"
            data-test="breaking-preview-error"
          >
            {preview.error}
          </p>
        )}

        {preview.status === 'ready' && (
          <BreakingPreviewList
            preview={preview.preview}
            labelOf={props.labelOf}
            stale={!previewed}
          />
        )}

        <Button
          type="button"
          className="w-full"
          data-test="breaking-schedule"
          disabled={!previewed || props.disabled || props.isScheduling}
          onClick={() => void onSchedule()}
        >
          {props.isScheduling ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Zap className="mr-2 h-4 w-4" />
          )}
          Schedule breaking release
        </Button>
      </form>
    </Form>
  );
}

function BreakingPreviewList(props: {
  preview: BreakingPreview;
  labelOf: (itemKey: string) => { label: string; full: boolean };
  stale: boolean;
}) {
  const { preview } = props;
  const placed = [...preview.placed].sort((a, b) =>
    a.scheduledAt.localeCompare(b.scheduledAt),
  );

  return (
    <div
      className="space-y-3 rounded-lg bg-muted/50 p-3"
      data-test="breaking-preview-result"
    >
      {props.stale && (
        <p className="text-xs text-amber-600">
          The settings changed: preview again before scheduling.
        </p>
      )}

      {preview.quota.length > 0 && (
        <div
          className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs"
          data-test="breaking-quota-warning"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <p>
            More than {preview.quota[0]!.limit} YouTube uploads on{' '}
            {preview.quota
              .map(
                (q) =>
                  `${format(new Date(`${q.day}T12:00:00`), 'EEE d MMM')} (${q.uploads})`,
              )
              .join(', ')}{' '}
            across the team&apos;s channels. Uploads past the daily quota fail
            until it resets at midnight Pacific. This is a warning; nothing is
            refused.
          </p>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-sm font-medium">Breaking posts</p>
        {placed.map((post) => {
          const { label, full } = props.labelOf(itemKeyOfTarget(post.key));

          return (
            <div
              key={post.key}
              className="flex items-center justify-between gap-2 rounded-md bg-background px-2 py-1.5 text-xs"
              data-test="breaking-placed"
            >
              <div className="flex min-w-0 items-center gap-2">
                {full ? (
                  <Film className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <Smartphone className="h-3.5 w-3.5 shrink-0 text-pink-500" />
                )}
                <span className="truncate">
                  {label} · {post.name}
                </span>
                {post.extra && <Badge variant="secondary">extra</Badge>}
              </div>
              <span className="shrink-0 text-muted-foreground">
                {when(post.scheduledAt)}
              </span>
            </div>
          );
        })}
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">
          Moves back ({preview.moves.length})
        </p>
        {preview.moves.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing already scheduled moves.
          </p>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {preview.moves.map((move) => (
              <div
                key={move.publishId}
                className="rounded-md bg-background px-2 py-1.5 text-xs"
                data-test="breaking-moved"
              >
                <p className="truncate">
                  {move.title ?? 'Short'} · {move.name}
                </p>
                <p className="flex items-center gap-1 text-muted-foreground">
                  {when(move.from)} <ArrowRight className="h-3 w-3" />{' '}
                  {when(move.to)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
