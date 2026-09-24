'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { YouTubeAudienceFormSchema } from '../lib/schemas/youtube-declaration.schema';
import {
  YOUTUBE_CATEGORIES,
  type YouTubeDeclaration,
  isYouTubeCategoryId,
} from '../lib/youtube-declaration';
import { updateYouTubeChannelSettingsAction } from '../server/connection-actions';

export interface YouTubeAudienceChannel {
  id: string;
  name: string;
  /** The channel's current answer, when editing one already declared. */
  madeForKids?: boolean | null;
  categoryId?: string | null;
}

export type YouTubeAudienceAnswer = YouTubeDeclaration & {
  connectionId: string;
};

/**
 * Asks who a YouTube channel is for, and its category (KB-30). YouTube
 * requires every upload to declare whether it is made for children; the
 * creator decides that for their channel, so nothing here is pre-selected
 * for a channel that has not answered yet.
 */
export function YouTubeAudienceDialog(props: {
  channels: YouTubeAudienceChannel[];
  onSaved: (answers: YouTubeAudienceAnswer[]) => void;
  onCancel: () => void;
}) {
  const [saveError, setSaveError] = useState<string | null>(null);

  // Typed explicitly: the defaults are deliberately partial — empty for a
  // channel that has not answered — so they cannot be what the type is
  // inferred from.
  const form = useForm<z.infer<typeof YouTubeAudienceFormSchema>>({
    resolver: zodResolver(YouTubeAudienceFormSchema),
    defaultValues: {
      channels: props.channels.map((channel) => ({
        connectionId: channel.id,
        madeForKids: channel.madeForKids ?? undefined,
        categoryId: isYouTubeCategoryId(channel.categoryId)
          ? channel.categoryId
          : undefined,
      })),
    },
  });

  const answers = form.watch('channels');
  const complete = answers.every(
    (answer) =>
      typeof answer.madeForKids === 'boolean' && Boolean(answer.categoryId),
  );

  const onSubmit = form.handleSubmit(async ({ channels }) => {
    setSaveError(null);

    for (const answer of channels) {
      try {
        await unwrap(updateYouTubeChannelSettingsAction(answer));
      } catch (error) {
        const name =
          props.channels.find((c) => c.id === answer.connectionId)?.name ??
          'this channel';
        setSaveError(
          `Could not save the audience for “${name}”. ${refusalMessage(error, 'Try again.')}`,
        );
        return;
      }
    }

    props.onSaved(channels);
  });

  const saving = form.formState.isSubmitting;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) props.onCancel();
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        data-test="youtube-audience-dialog"
      >
        <DialogHeader>
          <DialogTitle>Who is this YouTube channel for?</DialogTitle>
          <DialogDescription>
            YouTube requires every upload to say whether it is made for
            children. You decide this for your channel; it is sent with every
            upload to it, and you can change it in Settings → Platforms.{' '}
            <a
              className="underline"
              href="https://support.google.com/youtube/answer/9528076"
              target="_blank"
              rel="noreferrer"
            >
              YouTube&apos;s guidance
            </a>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            {props.channels.map((channel, index) => (
              <fieldset
                key={channel.id}
                className="space-y-4 rounded-lg border p-4"
                data-test="audience-row"
                data-connection-id={channel.id}
              >
                <legend className="px-1 text-sm font-medium">
                  {channel.name}
                </legend>

                <FormField
                  control={form.control}
                  name={`channels.${index}.madeForKids`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Audience</FormLabel>
                      <FormControl>
                        <RadioGroup
                          value={
                            typeof field.value === 'boolean'
                              ? String(field.value)
                              : ''
                          }
                          onValueChange={(value) =>
                            field.onChange(value === 'true')
                          }
                        >
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem
                              value="true"
                              data-test="audience-made-for-kids"
                            />
                            Yes, it&apos;s made for kids
                          </label>
                          <label className="flex items-center gap-2 text-sm">
                            <RadioGroupItem
                              value="false"
                              data-test="audience-not-for-kids"
                            />
                            No, it&apos;s not made for kids
                          </label>
                        </RadioGroup>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name={`channels.${index}.categoryId`}
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Category</FormLabel>
                      <Select
                        value={field.value ?? ''}
                        onValueChange={field.onChange}
                      >
                        <FormControl>
                          <SelectTrigger data-test="audience-category">
                            <SelectValue placeholder="Choose a category" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {YOUTUBE_CATEGORIES.map((category) => (
                            <SelectItem
                              key={category.id}
                              value={category.id}
                              data-test={`audience-category-${category.id}`}
                            >
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </fieldset>
            ))}

            {saveError && (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-test="audience-save-error"
              >
                {saveError}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={props.onCancel}
                disabled={saving}
                data-test="audience-cancel"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={!complete || saving}
                aria-describedby={complete ? undefined : 'audience-incomplete'}
                data-test="audience-continue"
              >
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Continue
              </Button>
            </DialogFooter>
            {!complete && (
              <p
                id="audience-incomplete"
                className="text-right text-xs text-muted-foreground"
              >
                Answer both questions for every channel to continue.
              </p>
            )}
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
