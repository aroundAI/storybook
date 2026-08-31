'use client';

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
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import { CreateExperimentSchema } from '../../lib/schemas/experiment.schema';

type CreateExperimentValues = z.infer<typeof CreateExperimentSchema>;

interface ExperimentFormProps {
  /** Account the experiment belongs to */
  accountId: string;
  /** Optional project scope */
  projectId?: string;
  /** Persists the experiment */
  onSubmit: (values: CreateExperimentValues) => Promise<void>;
  /** Called after a successful save */
  onSuccess?: () => void;
}

/**
 * Captures an experiment before it runs: what is changing, why, and what
 * result is expected. Recording the expectation up front is what makes the
 * eventual outcome informative rather than a post-hoc story.
 */
export function ExperimentForm({
  accountId,
  projectId,
  onSubmit,
  onSuccess,
}: ExperimentFormProps) {
  const form = useForm({
    resolver: zodResolver(CreateExperimentSchema),
    defaultValues: {
      accountId,
      projectId,
      title: '',
      hypothesis: '',
      changeDescription: '',
      expectedOutcome: '',
      publishIds: [],
      tagIds: [],
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  const handleSubmit = form.handleSubmit(async (values) => {
    try {
      await onSubmit(values);
      toast.success('Experiment logged');
      form.reset({
        accountId,
        projectId,
        title: '',
        hypothesis: '',
        changeDescription: '',
        expectedOutcome: '',
        publishIds: [],
        tagIds: [],
      });
      onSuccess?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not save the experiment',
      );
    }
  });

  return (
    <Form {...form}>
      <form
        onSubmit={handleSubmit}
        className={'flex flex-col gap-4'}
        data-test={'experiment-form'}
      >
        <FormField
          control={form.control}
          name={'title'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input
                  placeholder={'e.g. Shorter cold-open on process videos'}
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
                  placeholder={'Cut the intro from 20s to 5s on the next six uploads'}
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name={'hypothesis'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Hypothesis (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  placeholder={'The 0:45 retention cliff is caused by intro length'}
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
                  placeholder={'Retention at 0:45 improves by 10 points; views unchanged'}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Recorded before the result is known, so hindsight cannot
                rewrite it.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button type={'submit'} disabled={isSubmitting} className={'self-start'}>
          {isSubmitting ? (
            <Loader2 className={'mr-2 h-4 w-4 animate-spin'} />
          ) : null}
          Log experiment
        </Button>
      </form>
    </Form>
  );
}
