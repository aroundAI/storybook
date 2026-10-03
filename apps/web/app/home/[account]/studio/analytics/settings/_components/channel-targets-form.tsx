'use client';

import { useState } from 'react';

import { isRedirectError } from 'next/dist/client/components/redirect-error';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { buildChannelSettingsFormSchema } from '@kit/content-analytics/lib/schemas/settings';
import type { OverriddenTarget } from '@kit/content-analytics/lib/ypp-targets';
import { overriddenChannelTargets } from '@kit/content-analytics/lib/ypp-targets';
import { updateChannelAnalyticsSettingsAction } from '@kit/content-analytics/server/settings-actions';
import type { ChannelSettingsEntry } from '@kit/content-analytics/server/settings-service';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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

import { OverrideNumberField } from './override-number-field';

const REFUSAL_MESSAGE: Record<
  'no_access' | 'write_failed' | 'invalid_joined_date',
  string
> = {
  no_access: 'That channel is not part of this account.',
  write_failed: 'Settings could not be saved. Please try again.',
  invalid_joined_date: "Joined date can't be in the future.",
};

const STATUS_LABEL = {
  unknown: 'Unknown',
  new_applicant: 'New applicant',
  existing_partner: 'Already a partner',
} as const;

export function ChannelTargetsForm({
  channel,
  accountWatchHours,
  accountSubscribers,
  joinedCutoff,
}: {
  channel: ChannelSettingsEntry;
  /**
   * The account's own values, or null where it has none.
   *
   * Null rather than the shipped default on purpose: "the account has not
   * configured this" and "the account is using 4,000" resolve differently,
   * and collapsing them is what made the notice below cry wolf on every
   * account that had never saved a setting.
   */
  accountWatchHours: number | null;
  accountSubscribers: number | null;
  /**
   * The latest joined date that counts, from `latestJoinDate()` on the server.
   * A prop rather than a call here so the server and the browser cannot
   * disagree across a UTC day boundary — which would both mismatch on
   * hydration and change which override warnings render.
   */
  joinedCutoff: string;
}) {
  const [version, setVersion] = useState(0);

  const storedJoinedAt = channel.joined_ypp_at;

  const maxJoinedDate =
    storedJoinedAt && storedJoinedAt > joinedCutoff
      ? storedJoinedAt
      : joinedCutoff;

  const form = useForm({
    // Built from the stored value: a future date cannot be typed in, but the
    // one already on the row can be left alone while the targets are saved.
    resolver: zodResolver(buildChannelSettingsFormSchema(storedJoinedAt)),
    defaultValues: {
      connectionId: channel.connectionId,
      yppTargetWatchHours: channel.ypp_target_watch_hours,
      yppTargetSubscribers: channel.ypp_target_subscribers,
      yppApplicantStatus: channel.ypp_applicant_status as
        | 'unknown'
        | 'new_applicant'
        | 'existing_partner',
      joinedYppAt: channel.joined_ypp_at,
    },
  });

  const onSubmit = async (values: {
    connectionId: string;
    yppTargetWatchHours: number | null;
    yppTargetSubscribers: number | null;
    yppApplicantStatus: 'unknown' | 'new_applicant' | 'existing_partner';
    joinedYppAt: string | null;
  }) => {
    // See the account form: a rejection here would otherwise leave the button
    // enabled and say nothing at all.
    let result;

    try {
      result = await updateChannelAnalyticsSettingsAction(values);
    } catch (error) {
      if (isRedirectError(error)) throw error;

      toast.error(REFUSAL_MESSAGE.write_failed);
      return;
    }

    if (!result.ok) {
      toast.error(REFUSAL_MESSAGE[result.reason]);
      return;
    }

    form.reset(values);
    setVersion((current) => current + 1);
    toast.success(`Saved settings for ${channel.channelName}`);
  };

  return (
    <Card data-test={`channel-card-${channel.connectionId}`}>
      <CardHeader>
        <CardTitle>{channel.channelName}</CardTitle>
        <CardDescription>
          Blank inherits the account default. A channel already in the programme
          stops showing progress toward the gate.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className={'space-y-6'}
            data-test={'channel-targets-form'}
          >
            <OverriddenNotice
              overridden={overriddenChannelTargets({
                channelSettings: {
                  ypp_target_watch_hours: form.watch('yppTargetWatchHours'),
                  ypp_target_subscribers: form.watch('yppTargetSubscribers'),
                  ypp_applicant_status: form.watch('yppApplicantStatus'),
                  // The form's actual value, not null. A channel already in
                  // the programme is never measured against a target —
                  // `YppProgressCard` short-circuits on `alreadyJoined` — so
                  // warning that its override will be overruled describes a
                  // comparison that never happens.
                  joined_ypp_at: form.watch('joinedYppAt'),
                },
                accountSettings: {
                  ypp_target_watch_hours: accountWatchHours,
                  ypp_target_subscribers: accountSubscribers,
                },
                joinedCutoff,
              })}
            />

            <div key={version} className={'grid gap-6 md:grid-cols-2'}>
              <OverrideNumberField
                control={form.control}
                name={'yppTargetWatchHours'}
                label={'Watch hours target'}
                description={'Blank inherits the account default.'}
                placeholder={'Inherit'}
                dataTest={'channel-watch-hours-input'}
              />

              <OverrideNumberField
                control={form.control}
                name={'yppTargetSubscribers'}
                label={'Subscriber target'}
                description={'Blank inherits the account default.'}
                placeholder={'Inherit'}
                dataTest={'channel-subscribers-input'}
              />
            </div>

            <FormField
              control={form.control}
              name={'yppApplicantStatus'}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Applicant status</FormLabel>
                  {/*
                    Controlled. With `defaultValue` Radix owns the displayed
                    label, so after a reset the trigger keeps showing the
                    previous choice while form state has moved on.
                  */}
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-test={'channel-status-trigger'}>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(STATUS_LABEL).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Unknown shows the higher target where the account and this
                    channel disagree — over-stating the bar rather than
                    announcing a gate the channel has not cleared.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div key={`joined-${version}`}>
              <FormField
                control={form.control}
                name={'joinedYppAt'}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Joined the programme on</FormLabel>
                    <FormControl>
                      <Input
                        type={'date'}
                        value={field.value ?? ''}
                        // The bound, fixed on the server — computing it here
                        // would make the server (UTC) and the browser (local)
                        // render different HTML across a day boundary.
                        //
                        // Widened to a stored date already past it, so the
                        // browser does not refuse to submit the whole card
                        // for a row written before the bound existed. The
                        // resolver and the action both let that one value
                        // through while refusing any other future date.
                        max={maxJoinedDate}
                        data-test={'channel-joined-input'}
                        onChange={(event) =>
                          field.onChange(event.target.value || null)
                        }
                      />
                    </FormControl>
                    <FormDescription>
                      Leave blank if this channel has not joined yet.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Button
              type={'submit'}
              disabled={form.formState.isSubmitting}
              data-test={'channel-targets-submit'}
            >
              {form.formState.isSubmitting ? 'Saving…' : 'Save channel'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

/**
 * Says so when a target the user has typed will not be the one used.
 *
 * Which targets those are is decided by `overriddenChannelTargets`, which
 * asks the resolver. This component only renders the answer. An earlier
 * version compared the numbers here and disagreed with the rule it was
 * describing — telling people on a fresh account that a valid override would
 * be ignored, and to change a status they had no reason to change.
 */
function OverriddenNotice({ overridden }: { overridden: OverriddenTarget[] }) {
  if (overridden.length === 0) return null;

  return (
    <p
      className={'border-l-2 pl-3 text-xs text-muted-foreground'}
      data-test={'channel-overridden-notice'}
    >
      {overridden
        .map(
          (entry) =>
            `The ${METRIC_LABEL[entry.metric]} target ${entry.channel.toLocaleString()} will not be used; this channel is measured against ${entry.resolved.toLocaleString()}`,
        )
        .join('. ')}
      . While the applicant status is Unknown the higher of the two configured
      figures wins. Set the status to &ldquo;Already a partner&rdquo; if the
      lower bar is the real one.
    </p>
  );
}

const METRIC_LABEL: Record<OverriddenTarget['metric'], string> = {
  watchHours: 'watch hours',
  subscribers: 'subscriber',
};
