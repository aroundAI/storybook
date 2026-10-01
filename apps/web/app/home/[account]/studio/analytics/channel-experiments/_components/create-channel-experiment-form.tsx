'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, X } from 'lucide-react';
import { useFieldArray, useForm } from 'react-hook-form';

import {
  EXPERIMENT_MEASURES,
  EXPERIMENT_MEASURE_DEFINITIONS,
  FORMAT_FAMILY_LABEL,
  type FormatFamily,
} from '@kit/clickhouse';
import {
  refusalMessage,
  unwrap,
} from '@kit/content-analytics/lib/action-result';
import {
  type CreateChannelExperimentInput,
  CreateChannelExperimentSchema,
  ExperimentFormatFamilySchema,
  MAX_STYLES,
  MIN_STYLES,
} from '@kit/content-analytics/lib/schemas/channel-experiment';
import { createChannelExperimentAction } from '@kit/content-analytics/server/channel-experiment-actions';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
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

export interface ChannelOption {
  connectionId: string;
  name: string;
  platform: string;
}

const DEFAULT_MEASURES = EXPERIMENT_MEASURES.filter(
  (measure) => EXPERIMENT_MEASURE_DEFINITIONS[measure].families === null,
);

function blankValues(accountId: string): CreateChannelExperimentInput {
  return {
    accountId,
    connectionId: '',
    formatFamily: 'long_horizontal',
    title: '',
    hypothesis: '',
    expectedOutcome: '',
    measures: [...DEFAULT_MEASURES],
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    styles: [{ name: '' }, { name: '' }],
  };
}

/**
 * A new channel experiment: one channel, one format family (FILM-1716 —
 * Shorts and long-form are never pooled), 2–8 styles, the measures, and the
 * expectation written down before any result exists.
 */
export function CreateChannelExperimentForm(props: {
  accountId: string;
  channels: ChannelOption[];
  channelsLoading: boolean;
  onCreated: (id: string) => Promise<unknown> | void;
}) {
  // Remounts the selects after a save: Radix keeps a displayed value
  // across reset() (the FILM-1609 lesson).
  const [generation, setGeneration] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(CreateChannelExperimentSchema),
    defaultValues: blankValues(props.accountId),
  });

  const styles = useFieldArray({ control: form.control, name: 'styles' });
  const family = form.watch('formatFamily') as FormatFamily;

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);

    try {
      const { id } = await unwrap(createChannelExperimentAction(values));
      toast.success('Experiment created');
      form.reset(blankValues(props.accountId));
      setGeneration((current) => current + 1);
      await props.onCreated(id);
    } catch (failure) {
      const message = refusalMessage(failure, 'It was not created. Try again.');
      setError(message);
      toast.error(message);
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className={'flex flex-col gap-4 rounded-lg border p-4'}
        data-test={'ce-form'}
        noValidate
      >
        <FormField
          control={form.control}
          name={'title'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  placeholder={'e.g. Thumbnail mouth open or closed'}
                  data-test={'ce-title'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className={'grid gap-4 sm:grid-cols-2'} key={generation}>
          <FormField
            control={form.control}
            name={'connectionId'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Channel</FormLabel>
                <Select
                  value={field.value || undefined}
                  onValueChange={field.onChange}
                  disabled={props.channelsLoading}
                >
                  <FormControl>
                    <SelectTrigger data-test={'ce-channel'}>
                      <SelectValue
                        placeholder={
                          props.channelsLoading
                            ? 'Loading channels…'
                            : 'Choose a channel'
                        }
                      />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {props.channels.map((channel) => (
                      <SelectItem
                        key={channel.connectionId}
                        value={channel.connectionId}
                        data-test={`ce-channel-option-${channel.connectionId}`}
                      >
                        {channel.name} ({channel.platform})
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
            name={'formatFamily'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Format</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={(next) => {
                    field.onChange(next);
                    // The hook measure exists only for short-form.
                    form.setValue(
                      'measures',
                      form
                        .getValues('measures')
                        .filter((measure) =>
                          (
                            EXPERIMENT_MEASURE_DEFINITIONS[measure]
                              .families ?? [next]
                          ).includes(next as FormatFamily),
                        ),
                    );
                  }}
                >
                  <FormControl>
                    <SelectTrigger data-test={'ce-family'}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {ExperimentFormatFamilySchema.options.map((option) => (
                      <SelectItem
                        key={option}
                        value={option}
                        data-test={`ce-family-option-${option}`}
                      >
                        {FORMAT_FAMILY_LABEL[option as FormatFamily]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Shorts and long-form are never compared in one experiment.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <fieldset className={'flex flex-col gap-2'}>
          <legend className={'mb-1 text-sm font-medium'}>
            Styles ({MIN_STYLES}–{MAX_STYLES})
          </legend>
          {styles.fields.map((style, index) => (
            <div key={style.id} className={'flex items-start gap-2'}>
              <FormField
                control={form.control}
                name={`styles.${index}.name`}
                render={({ field }) => (
                  <FormItem className={'flex-1'}>
                    <FormControl>
                      <Input
                        aria-label={`Style ${index + 1}`}
                        placeholder={`Style ${index + 1}, e.g. ${index === 0 ? 'Mouth open' : 'Mouth closed'}`}
                        data-test={`ce-style-name-${index}`}
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type={'button'}
                variant={'ghost'}
                size={'icon'}
                aria-label={`Remove style ${index + 1}`}
                disabled={styles.fields.length <= MIN_STYLES}
                onClick={() => styles.remove(index)}
                data-test={`ce-style-remove-${index}`}
              >
                <X className={'h-4 w-4'} />
              </Button>
            </div>
          ))}
          <Button
            type={'button'}
            variant={'outline'}
            size={'sm'}
            className={'self-start'}
            disabled={styles.fields.length >= MAX_STYLES}
            onClick={() => styles.append({ name: '' })}
            data-test={'ce-style-add'}
          >
            <Plus className={'mr-1 h-4 w-4'} /> Add a style
          </Button>
          {form.formState.errors.styles?.root?.message ||
          form.formState.errors.styles?.message ? (
            <p className={'text-sm text-destructive'} role={'alert'}>
              {form.formState.errors.styles?.root?.message ??
                form.formState.errors.styles?.message}
            </p>
          ) : null}
        </fieldset>

        <FormField
          control={form.control}
          name={'measures'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Measures</FormLabel>
              <div className={'grid gap-2 sm:grid-cols-2'}>
                {EXPERIMENT_MEASURES.map((measure) => {
                  const definition = EXPERIMENT_MEASURE_DEFINITIONS[measure];
                  const offered =
                    definition.families === null ||
                    definition.families.includes(family);

                  if (!offered) return null;

                  return (
                    <label
                      key={measure}
                      className={'flex items-center gap-2 text-sm'}
                    >
                      <Checkbox
                        checked={field.value.includes(measure)}
                        onCheckedChange={(checked) =>
                          field.onChange(
                            checked
                              ? [...field.value, measure]
                              : field.value.filter((m) => m !== measure),
                          )
                        }
                        data-test={`ce-measure-${measure}`}
                      />
                      {definition.label}
                    </label>
                  );
                })}
              </div>
              <FormDescription>
                Views at 7 and 30 days; the rest over each video&apos;s own
                first days. Every video is measured at the same age.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className={'grid gap-4 sm:grid-cols-2'}>
          <FormField
            control={form.control}
            name={'hypothesis'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Hypothesis (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={2} data-test={'ce-hypothesis'} {...field} />
                </FormControl>
                <FormDescription>
                  Fixed once the experiment starts.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name={'expectedOutcome'}
            render={({ field }) => (
              <FormItem>
                <FormLabel>What do you expect? (optional)</FormLabel>
                <FormControl>
                  <Textarea rows={2} data-test={'ce-expected'} {...field} />
                </FormControl>
                <FormDescription>
                  Fixed once the experiment starts.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {error ? (
          <p
            className={'text-sm text-destructive'}
            role={'alert'}
            data-test={'ce-form-error'}
          >
            {error}
          </p>
        ) : null}

        <Button
          type={'submit'}
          className={'self-start'}
          disabled={form.formState.isSubmitting}
          data-test={'ce-submit'}
        >
          {form.formState.isSubmitting ? (
            <Loader2 className={'mr-2 h-4 w-4 animate-spin'} />
          ) : null}
          Create experiment
        </Button>
      </form>
    </Form>
  );
}
