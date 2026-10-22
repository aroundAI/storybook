'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { YOUTUBE_HD_NOTE } from '@kit/publishing/lib/schedule-view';
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

import { updateStudioSettingsAction } from '../../settings/_lib/server/update-studio-settings.action';

const LeadSchema = z.object({
  youtubeLeadMinutes: z.coerce
    .number({ invalid_type_error: 'Enter a number of minutes.' })
    .int('Whole minutes.')
    .min(0, 'At least 0.')
    .max(1440, 'At most 1440 (a day).'),
});

/**
 * KB-214. How long before its time a project's YouTube post is uploaded,
 * private, so YouTube has made it HD by launch. 0 uploads at its time,
 * public, as before.
 */
export function YouTubeLeadForm(props: {
  projectId: string;
  youtubeLeadMinutes: number;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(LeadSchema),
    defaultValues: { youtubeLeadMinutes: props.youtubeLeadMinutes },
  });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      try {
        await unwrap(
          updateStudioSettingsAction({
            projectId: props.projectId,
            youtubeLeadMinutes: values.youtubeLeadMinutes,
          }),
        );
        toast.success('YouTube upload lead time saved.');
        form.reset(values);
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'That did not save. Try again.'));
      }
    });
  });

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className="flex flex-wrap items-end gap-2 border-t pt-4"
        data-test="youtube-lead-form"
      >
        <FormField
          control={form.control}
          name="youtubeLeadMinutes"
          render={({ field }) => (
            <FormItem className="min-w-0 flex-1">
              <FormLabel>YouTube: upload this many minutes early</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  max={1440}
                  step={1}
                  className="w-32"
                  data-test="youtube-lead-minutes"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                {YOUTUBE_HD_NOTE} Default 120; 0 uploads at the post&apos;s
                time, public.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button
          type="submit"
          size="sm"
          disabled={saving || !form.formState.isDirty}
          data-test="youtube-lead-save"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save
        </Button>
      </form>
    </Form>
  );
}
