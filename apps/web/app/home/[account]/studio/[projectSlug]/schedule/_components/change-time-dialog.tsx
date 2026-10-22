'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  type ScheduleMove,
  ScheduleMovesTable,
} from '@kit/publishing/components';
import {
  ChangeTimeFormSchema,
  type ChangeTimeFormValues,
  type ReschedulePublishInput,
} from '@kit/publishing/lib/schemas/schedule-release';
import {
  previewReschedulePublishAction,
  reschedulePublishAction,
} from '@kit/publishing/server';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
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
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import type { ScheduleRow } from './schedule-status-cell';

/** An instant as a datetime-local value in the browser's zone */
export function toLocalInput(iso: string | null) {
  if (!iso) return '';

  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

function browserTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface Preview {
  key: string;
  moves: ScheduleMove[];
  cadenceRefusal: string | null;
}

/**
 * FILM-2213. A scheduled post's time, changed in place: a time in the tab's
 * zone, what else moves (a long video's Shorts and those behind them), the
 * posting rules' refusal with an override for an experiment, and a note
 * kept in the post's history. The time is previewed before it is moved.
 */
export function ChangeTimeDialog(props: {
  row: ScheduleRow;
  onClose: () => void;
}) {
  const { row } = props;
  const router = useRouter();
  const long = row.contentType !== 'short';
  const [state, setState] = useState<{
    preview: Preview | null;
    error: string | null;
  }>({ preview: null, error: null });

  const form = useForm({
    resolver: zodResolver(ChangeTimeFormSchema),
    defaultValues: {
      at: toLocalInput(row.at),
      allPlatforms: long,
      ignoreCadence: false,
      note: '',
    },
  });

  const inputOf = (values: ChangeTimeFormValues): ReschedulePublishInput => ({
    ...(long && values.allPlatforms
      ? { episodeId: row.episodeId, contentType: 'full' as const }
      : { publishId: row.publishId }),
    scheduledAt: new Date(values.at).toISOString(),
    ignoreCadence: values.ignoreCadence,
    note: values.note.trim() || undefined,
    timezone: browserTimeZone(),
  });

  /** The preview for these values: the one shown, or a new one */
  const previewOf = async (values: ChangeTimeFormValues) => {
    const input = inputOf(values);
    const key = JSON.stringify({ ...input, ignoreCadence: false, note: null });

    if (state.preview?.key === key) return state.preview;

    const result = await unwrap(previewReschedulePublishAction(input));
    const preview = {
      key,
      moves: result.moves,
      cadenceRefusal: result.cadenceRefusal,
    };
    setState({ preview, error: null });

    return preview;
  };

  const onPreview = form.handleSubmit(async (values) => {
    try {
      await previewOf(values);
    } catch (error) {
      setState({
        preview: null,
        error: refusalMessage(error, 'That time could not be checked.'),
      });
    }
  });

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const preview = await previewOf(values);

      // The rules refuse it: shown, with the override, before anything moves
      if (preview.cadenceRefusal && !values.ignoreCadence) return;

      const result = await unwrap(reschedulePublishAction(inputOf(values)));

      toast.success(
        `Moved ${result.moves.length} post${result.moves.length === 1 ? '' : 's'}.`,
      );
      props.onClose();
      router.refresh();
    } catch (error) {
      setState((current) => ({
        ...current,
        error: refusalMessage(error, 'That post could not be moved.'),
      }));
    }
  });

  const busy = form.formState.isSubmitting;
  const { preview, error } = state;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && props.onClose()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"
        data-test="change-time-dialog"
      >
        <DialogHeader>
          <DialogTitle>Change time</DialogTitle>
          <DialogDescription>
            {row.title ?? 'This post'} moves in place: its title, tags,
            thumbnail and Shorts group stay.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={onSubmit}
            className="space-y-4"
            data-test="change-time-form"
          >
            <FormField
              control={form.control}
              name="at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New time</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      data-test="change-time-at"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>In your timezone.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {long && (
              <FormField
                control={form.control}
                name="allPlatforms"
                render={({ field }) => (
                  <FormItem className="flex-row items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) =>
                          field.onChange(checked === true)
                        }
                        data-test="change-time-all-platforms"
                      />
                    </FormControl>
                    <FormLabel className="font-normal">
                      Move this episode&apos;s long video on every platform
                    </FormLabel>
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="note"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Note</FormLabel>
                  <FormControl>
                    <Textarea
                      rows={2}
                      placeholder="Why, for the post's history"
                      data-test="change-time-note"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {preview?.cadenceRefusal && (
              <div
                className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30"
                data-test="change-time-refusal"
              >
                <p className="text-sm">{preview.cadenceRefusal}</p>
                <FormField
                  control={form.control}
                  name="ignoreCadence"
                  render={({ field }) => (
                    <FormItem className="flex-row items-center gap-2">
                      <FormControl>
                        <Checkbox
                          checked={field.value}
                          onCheckedChange={(checked) =>
                            field.onChange(checked === true)
                          }
                          data-test="change-time-override"
                        />
                      </FormControl>
                      <FormLabel className="font-normal">
                        Override posting rules for this experiment
                      </FormLabel>
                    </FormItem>
                  )}
                />
              </div>
            )}

            {preview && preview.moves.length > 0 && (
              <div className="space-y-2" data-test="change-time-preview">
                <p className="text-sm font-medium">
                  This moves {preview.moves.length} post
                  {preview.moves.length === 1 ? '' : 's'}
                </p>
                <ScheduleMovesTable moves={preview.moves} />
              </div>
            )}

            {error && (
              <p
                className="text-sm text-destructive"
                data-test="change-time-error"
              >
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={props.onClose}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={onPreview}
                data-test="change-time-preview-button"
              >
                Preview
              </Button>
              <Button
                type="submit"
                disabled={busy}
                data-test="change-time-save"
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Move
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
