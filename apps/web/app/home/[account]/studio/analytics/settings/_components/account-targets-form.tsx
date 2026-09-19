'use client';

import { useState } from 'react';

import { isRedirectError } from 'next/dist/client/components/redirect-error';
import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { UpdateAccountAnalyticsSettingsSchema } from '@kit/content-analytics/lib/schemas/settings';
import { ANALYTICS_DEFAULTS } from '@kit/content-analytics/lib/ypp-targets';
import { updateAccountAnalyticsSettingsAction } from '@kit/content-analytics/server/settings-actions';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Form } from '@kit/ui/form';
import { toast } from '@kit/ui/sonner';

import { OverrideNumberField } from './override-number-field';

export interface AccountSettingsValues {
  yppTargetWatchHours: number | null;
  yppTargetSubscribers: number | null;
  tagMinSample: number | null;
}

const REFUSAL_MESSAGE: Record<'no_access' | 'write_failed', string> = {
  no_access: 'You do not have access to this account.',
  write_failed: 'Settings could not be saved. Please try again.',
};

export function AccountTargetsForm({
  accountId,
  initial,
}: {
  accountId: string;
  initial: AccountSettingsValues;
}) {
  // Remounting the fields after a save is what keeps the text inputs honest.
  // They hold their own display text, so a reset that only touched form
  // state would leave the previous text on screen while the form believed
  // something else — the exact DOM/form-state split that took FILM-1609
  // four review rounds to find.
  const router = useRouter();
  const [version, setVersion] = useState(0);
  const [saved, setSaved] = useState(initial);

  const form = useForm({
    resolver: zodResolver(UpdateAccountAnalyticsSettingsSchema),
    defaultValues: { accountId, ...initial },
  });

  const onSubmit = async (values: {
    accountId: string;
    yppTargetWatchHours: number | null;
    yppTargetSubscribers: number | null;
    tagMinSample: number | null;
  }) => {
    // The action reports refusals as `{ ok: false }` rather than throwing,
    // because Next masks Server Action errors in production. Anything that
    // still throws — a server-side schema failure, an unexpected exception —
    // rejects here, and `handleSubmit` would re-enable the button with no
    // toast at all: a save that looks like it was simply ignored.
    let result;

    try {
      result = await updateAccountAnalyticsSettingsAction(values);
    } catch (error) {
      if (isRedirectError(error)) throw error;

      toast.error(REFUSAL_MESSAGE.write_failed);
      return;
    }

    if (!result.ok) {
      toast.error(REFUSAL_MESSAGE[result.reason]);
      return;
    }

    const next = {
      yppTargetWatchHours: values.yppTargetWatchHours,
      yppTargetSubscribers: values.yppTargetSubscribers,
      tagMinSample: values.tagMinSample,
    };

    setSaved(next);
    form.reset({ accountId, ...next });
    setVersion((current) => current + 1);

    // The channel cards below are server-rendered with the account's values,
    // and one of them compares against those values to warn that a lower
    // override will lose to the over-state rule. Without this the warning
    // keeps quoting the figure from page load: a screenshot caught it saying
    // "lower than the account's 4,000" directly under a field reading 3,500.
    router.refresh();

    toast.success('Analytics settings saved');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account defaults</CardTitle>
        <CardDescription>
          Applied to every channel that does not set its own target. Leave a
          field blank to use the shipped default.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className={'space-y-6'}
            data-test={'account-targets-form'}
          >
            <div key={version} className={'space-y-6'}>
              <OverrideNumberField
                control={form.control}
                name={'yppTargetWatchHours'}
                label={'Watch hours target'}
                description={`Blank uses ${ANALYTICS_DEFAULTS.watchHours.toLocaleString()}. Our figure approximates YouTube's, which adjusts for deleted and ineligible content no API exposes.`}
                placeholder={String(ANALYTICS_DEFAULTS.watchHours)}
                dataTest={'account-watch-hours-input'}
              />

              <OverrideNumberField
                control={form.control}
                name={'yppTargetSubscribers'}
                label={'Subscriber target'}
                description={`Blank uses ${ANALYTICS_DEFAULTS.subscribers.toLocaleString()}.`}
                placeholder={String(ANALYTICS_DEFAULTS.subscribers)}
                dataTest={'account-subscribers-input'}
              />

              <OverrideNumberField
                control={form.control}
                name={'tagMinSample'}
                label={'Minimum videos per tag'}
                description={`Tags with fewer videos than this are left out of tag medians. Blank uses ${ANALYTICS_DEFAULTS.tagMinSample}.`}
                placeholder={String(ANALYTICS_DEFAULTS.tagMinSample)}
                dataTest={'account-tag-min-sample-input'}
              />
            </div>

            <div className={'flex items-center gap-3'}>
              <Button
                type={'submit'}
                disabled={form.formState.isSubmitting}
                data-test={'account-targets-submit'}
              >
                {form.formState.isSubmitting ? 'Saving…' : 'Save defaults'}
              </Button>

              <span
                className={'text-xs text-muted-foreground'}
                data-test={'account-targets-saved'}
              >
                {describeSaved(saved)}
              </span>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

function describeSaved(values: AccountSettingsValues) {
  const configured = [
    values.yppTargetWatchHours === null ? null : 'watch hours',
    values.yppTargetSubscribers === null ? null : 'subscribers',
    values.tagMinSample === null ? null : 'tag sample',
  ].filter((entry): entry is string => entry !== null);

  return configured.length === 0
    ? 'All three using defaults'
    : `Set: ${configured.join(', ')}`;
}
