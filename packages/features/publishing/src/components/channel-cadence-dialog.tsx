'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, X } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { Switch } from '@kit/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';

import {
  type CadenceContentType,
  type ChannelCadence,
  DEFAULT_CADENCE,
} from '../lib/cadence/cadence';
import { takesVideo } from '../lib/constants';
import {
  type ChannelCadenceInput,
  ChannelCadenceSchema,
} from '../lib/schemas/schedule-release.schema';
import {
  previewChannelCadenceAction,
  saveChannelCadenceAction,
} from '../server/schedule-release-actions';
import {
  type ScheduleMove,
  ScheduleMovesTable,
  type ScheduleNotMoved,
} from './schedule-moves-table';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface ChannelCadenceState {
  contentType: CadenceContentType;
  /** The channel has its own row; otherwise the defaults are shown */
  own: boolean;
  enabled: boolean;
  cadence: Omit<ChannelCadence, 'timezone'> & { timezone: string | null };
}

/**
 * FILM-719, FILM-2209. When one channel posts: its slots (their count is
 * how many it posts a day), the days it posts, every how many days, and the
 * spacing. Shorts and long videos each have their own; a channel shows
 * only the kinds its platform takes (Instagram: Shorts).
 */
export function ChannelCadenceDialog(props: {
  channel: { id: string; name: string; platform: string };
  cadences: ChannelCadenceState[];
  defaultTimezone: string;
  initialType?: CadenceContentType;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const takesLong = takesVideo('full', props.channel.platform);
  const [contentType, setContentType] = useState<CadenceContentType>(
    takesLong ? (props.initialType ?? 'short') : 'short',
  );
  const state = props.cadences.find((c) => c.contentType === contentType);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onCancel()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        data-test="channel-cadence-dialog"
      >
        <DialogHeader>
          <DialogTitle>Posting rules for {props.channel.name}</DialogTitle>
          <DialogDescription data-test="channel-cadence-scope">
            These rules are the channel&apos;s: every project and episode that
            posts to {props.channel.name} follows them, so it never gets a burst
            of uploads. The number of posting times is the most it posts in a
            day.
          </DialogDescription>
        </DialogHeader>

        {takesLong ? (
          <Tabs
            value={contentType}
            onValueChange={(value) =>
              setContentType(value as CadenceContentType)
            }
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="short" data-test="cadence-tab-short">
                Shorts &amp; Reels
              </TabsTrigger>
              <TabsTrigger value="full" data-test="cadence-tab-full">
                Long videos
              </TabsTrigger>
            </TabsList>
          </Tabs>
        ) : (
          <p className="text-sm font-medium" data-test="cadence-shorts-only">
            Shorts &amp; Reels: this channel takes no long videos.
          </p>
        )}

        <CadenceForm
          key={contentType}
          connectionId={props.channel.id}
          contentType={contentType}
          state={state}
          defaultTimezone={props.defaultTimezone}
          onSaved={props.onSaved}
          onCancel={props.onCancel}
        />
      </DialogContent>
    </Dialog>
  );
}

function CadenceForm(props: {
  connectionId: string;
  contentType: CadenceContentType;
  state: ChannelCadenceState | undefined;
  defaultTimezone: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);
  const cadence = props.state?.cadence ?? {
    ...DEFAULT_CADENCE[props.contentType],
    timezone: null,
  };
  const short = props.contentType === 'short';

  const form = useForm({
    resolver: zodResolver(ChannelCadenceSchema),
    defaultValues: {
      connectionId: props.connectionId,
      contentType: props.contentType,
      timezone: cadence.timezone ?? props.defaultTimezone,
      slotTimes: cadence.slotTimes,
      daysOfWeek: cadence.daysOfWeek,
      minDaysBetween: cadence.minDaysBetween,
      everyNDays: cadence.everyNDays,
      startAfterHours: cadence.startAfterHours,
      jitterMinutes: cadence.jitterMinutes,
      enabled: props.state?.enabled ?? true,
    },
  });

  // FILM-2213: saving re-plans what is scheduled; it is shown first
  const [step, setStep] = useState<
    | { kind: 'form' }
    | { kind: 'confirm'; values: ChannelCadenceInput; moves: ScheduleMove[] }
    | {
        kind: 'result';
        moves: ScheduleMove[];
        notMoved: ScheduleNotMoved[];
        refusal: string | null;
      }
  >({ kind: 'form' });
  const [applying, setApplying] = useState(false);

  const save = async (values: ChannelCadenceInput) => {
    const saved = await unwrap(saveChannelCadenceAction(values));
    const moves = saved.replan?.moves ?? [];
    const notMoved = saved.replan?.notMoved ?? [];

    if (moves.length === 0 && notMoved.length === 0 && !saved.replanRefusal) {
      props.onSaved();
      return;
    }

    setStep({
      kind: 'result',
      moves,
      notMoved,
      refusal: saved.replanRefusal,
    });
  };

  const onSubmit = form.handleSubmit(async (values) => {
    setSaveError(null);

    try {
      const preview = await unwrap(previewChannelCadenceAction(values));
      const moves = preview.replan?.moves ?? [];

      if (moves.length > 0) {
        setStep({ kind: 'confirm', values, moves });
        return;
      }

      await save(values);
    } catch (error) {
      setSaveError(refusalMessage(error, 'Could not save. Try again.'));
    }
  });

  const apply = async (values: ChannelCadenceInput) => {
    setApplying(true);
    setSaveError(null);

    try {
      await save(values);
    } catch (error) {
      setSaveError(refusalMessage(error, 'Could not save. Try again.'));
      setStep({ kind: 'form' });
    } finally {
      setApplying(false);
    }
  };

  const saving = form.formState.isSubmitting;

  if (step.kind === 'confirm') {
    const count = step.moves.length;

    return (
      <div className="space-y-4" data-test="cadence-replan-confirm">
        <p className="text-sm font-medium">
          Saving moves {count} scheduled post{count === 1 ? '' : 's'}
        </p>
        <p className="text-sm text-muted-foreground">
          Everything scheduled on this channel is laid again on the new rules:
          long videos in their order, then the Shorts queue. Posts due within 15
          minutes, breaking posts and times chosen past the rules stay.
        </p>
        <ScheduleMovesTable moves={step.moves} />
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={applying}
            onClick={() => setStep({ kind: 'form' })}
            data-test="cadence-replan-back"
          >
            Back
          </Button>
          <Button
            type="button"
            disabled={applying}
            onClick={() => apply(step.values)}
            data-test="cadence-replan-apply"
          >
            {applying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save and move {count} post{count === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  if (step.kind === 'result') {
    return (
      <div className="space-y-4" data-test="cadence-replan-result">
        <p className="text-sm font-medium">
          Posting rules saved.{' '}
          {step.refusal
            ? 'The scheduled posts did not move.'
            : `${step.moves.length} scheduled post${step.moves.length === 1 ? '' : 's'} moved.`}
        </p>
        {step.refusal && (
          <p
            className="text-sm text-destructive"
            data-test="cadence-replan-refusal"
          >
            {step.refusal}
          </p>
        )}
        <ScheduleMovesTable moves={step.moves} notMoved={step.notMoved} />
        <DialogFooter>
          <Button
            type="button"
            onClick={props.onSaved}
            data-test="cadence-replan-done"
          >
            Done
          </Button>
        </DialogFooter>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className="space-y-5"
        data-test="channel-cadence-form"
        data-content-type={props.contentType}
      >
        <FormField
          control={form.control}
          name="slotTimes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Posting times</FormLabel>
              <div className="flex flex-wrap items-center gap-2">
                {field.value.map((time, index) => (
                  <div key={index} className="flex items-center gap-1">
                    <Input
                      type="time"
                      className="w-28"
                      value={time}
                      data-test="cadence-slot-time"
                      onChange={(event) =>
                        field.onChange(
                          field.value.map((t, i) =>
                            i === index ? event.target.value : t,
                          ),
                        )
                      }
                    />
                    {field.value.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${time}`}
                        data-test="cadence-slot-remove"
                        onClick={() =>
                          field.onChange(
                            field.value.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                {field.value.length < 6 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-test="cadence-slot-add"
                    onClick={() => field.onChange([...field.value, '12:00'])}
                  >
                    <Plus className="mr-1 h-4 w-4" />
                    Add a time
                  </Button>
                )}
              </div>
              <FormDescription data-test="cadence-per-day">
                {short
                  ? `${field.value.length} Short${field.value.length === 1 ? '' : 's'} a day, at these times.`
                  : field.value.length === 1
                    ? 'At most one long video a day.'
                    : `At most ${field.value.length} long videos a day.`}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="daysOfWeek"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Days</FormLabel>
              <div className="flex flex-wrap gap-3">
                {WEEKDAYS.map((name, day) => (
                  <label
                    key={name}
                    className="flex items-center gap-1.5 text-sm"
                  >
                    <Checkbox
                      checked={field.value.includes(day)}
                      data-test={`cadence-day-${day}`}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked
                            ? [...field.value, day].sort()
                            : field.value.filter((d) => d !== day),
                        )
                      }
                    />
                    {name}
                  </label>
                ))}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {short ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="everyNDays"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Post Shorts every</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        max={30}
                        className="w-24"
                        data-test="cadence-every-n-days"
                        {...field}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">
                      {Number(field.value) === 1 ? 'day' : 'days'}
                    </span>
                  </div>
                  <FormDescription>
                    1 is every day, 2 every other day.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="startAfterHours"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Start after the long video</FormLabel>
                  <div className="flex items-center gap-2">
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={168}
                        className="w-24"
                        data-test="cadence-start-after-hours"
                        {...field}
                      />
                    </FormControl>
                    <span className="text-sm text-muted-foreground">hours</span>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <p className="text-sm text-muted-foreground sm:col-span-2">
              Shorts post in order, oldest episode first. An episode&apos;s
              Shorts start after its long video and keep posting after the next
              one until they are all out.
            </p>
          </div>
        ) : (
          <FormField
            control={form.control}
            name="minDaysBetween"
            render={({ field }) => (
              <FormItem>
                <FormLabel>A long video every</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={30}
                      className="w-24"
                      data-test="cadence-min-days-between"
                      {...field}
                    />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">days</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="jitterMinutes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Vary the time by up to</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={120}
                      className="w-24"
                      data-test="cadence-jitter-minutes"
                      {...field}
                    />
                  </FormControl>
                  <span className="text-sm text-muted-foreground">min</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="timezone"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Timezone</FormLabel>
                <FormControl>
                  <Input
                    list="cadence-timezones"
                    data-test="cadence-timezone"
                    {...field}
                  />
                </FormControl>
                <datalist id="cadence-timezones">
                  {timeZones().map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="enabled"
          render={({ field }) => (
            <FormItem className="flex-row items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <FormLabel>Use these rules</FormLabel>
                <FormDescription>
                  Off: the channel posts on the default rules.
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  data-test="cadence-enabled"
                />
              </FormControl>
            </FormItem>
          )}
        />

        {saveError && (
          <p className="text-sm text-destructive" data-test="cadence-error">
            {saveError}
          </p>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={props.onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving} data-test="cadence-save">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}

function timeZones(): string[] {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}
