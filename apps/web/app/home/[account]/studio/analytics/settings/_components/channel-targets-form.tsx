'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { UpdateChannelAnalyticsSettingsSchema } from '@kit/content-analytics/lib/schemas/settings';
import type { ChannelSettingsEntry } from '@kit/content-analytics/server/settings-actions';
import { updateChannelAnalyticsSettingsAction } from '@kit/content-analytics/server/settings-actions';
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

const REFUSAL_MESSAGE: Record<'no_access' | 'write_failed', string> = {
  no_access: 'That channel is not part of this account.',
  write_failed: 'Settings could not be saved. Please try again.',
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
}: {
  channel: ChannelSettingsEntry;
  /** The account-level values this channel inherits, already resolved. */
  accountWatchHours: number;
  accountSubscribers: number;
}) {
  const [version, setVersion] = useState(0);

  const form = useForm({
    resolver: zodResolver(UpdateChannelAnalyticsSettingsSchema),
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
    const result = await updateChannelAnalyticsSettingsAction(values);

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
              status={form.watch('yppApplicantStatus')}
              entries={[
                {
                  label: 'watch hours',
                  channel: form.watch('yppTargetWatchHours'),
                  account: accountWatchHours,
                },
                {
                  label: 'subscribers',
                  channel: form.watch('yppTargetSubscribers'),
                  account: accountSubscribers,
                },
              ]}
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
 * With the default `unknown` status, a channel value *lower* than the
 * account value loses to the over-state rule — the save succeeds, the toast
 * fires, the number round-trips on reload, and the progress card goes on
 * using the account's. Everything says it worked. Without this notice the
 * most likely first action anyone takes on this page, lowering one channel's
 * bar, appears to work and does not.
 */
function OverriddenNotice({
  status,
  entries,
}: {
  status: 'unknown' | 'new_applicant' | 'existing_partner';
  entries: Array<{ label: string; channel: number | null; account: number }>;
}) {
  if (status !== 'unknown') return null;

  const overridden = entries.filter(
    (entry) => entry.channel !== null && entry.channel < entry.account,
  );

  if (overridden.length === 0) return null;

  return (
    <p
      className={'text-muted-foreground border-l-2 pl-3 text-xs'}
      data-test={'channel-overridden-notice'}
    >
      {overridden
        .map(
          (entry) =>
            `The ${entry.label} target below ${entry.channel!.toLocaleString()} is lower than the account's ${entry.account.toLocaleString()}`,
        )
        .join('; ')}
      . While the applicant status is Unknown the higher figure is used, so this
      channel will still be measured against the account target. Set the status
      to &ldquo;Already a partner&rdquo; if the lower bar is the real one.
    </p>
  );
}
