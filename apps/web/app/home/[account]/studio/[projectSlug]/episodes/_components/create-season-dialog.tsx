'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { FolderPlus, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import {
  type CreateSeasonInput,
  CreateSeasonSchema,
} from '@kit/episodes/schemas';
import { createSeasonAction } from '@kit/episodes/server';
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

/**
 * FILM-2203: a season with only a name. Episodes are added to it later,
 * one at a time or with Generate Season.
 */
export function CreateSeasonDialog({
  projectId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerButton = true,
}: {
  projectId: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerButton?: boolean;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen;
  const router = useRouter();

  const defaults: CreateSeasonInput = {
    projectId,
    name: '',
    description: '',
    directionNotes: '',
  };

  const form = useForm({
    resolver: zodResolver(CreateSeasonSchema),
    defaultValues: defaults,
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(data: CreateSeasonInput) {
    try {
      const result = await unwrap(
        createSeasonAction({
          projectId,
          name: data.name,
          description: data.description || undefined,
          directionNotes: data.directionNotes || undefined,
        }),
      );

      toast.success(`Season ${result.data.number} created`);
      setIsOpen(false);
      form.reset(defaults);
      router.refresh();
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to create the season'));
    }
  }

  return (
    <>
      {triggerButton && (
        <Button
          variant="outline"
          onClick={() => setIsOpen(true)}
          data-test="create-season-trigger"
        >
          <FolderPlus className="mr-2 h-4 w-4" />
          New season
        </Button>
      )}
      <Dialog
        open={isOpen}
        onOpenChange={(next) => {
          if (next) form.reset(defaults);
          setIsOpen(next);
        }}
      >
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>New season</DialogTitle>
            <DialogDescription>
              Name it now and add episodes whenever you like.
            </DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input
                        data-test="create-season-name"
                        placeholder="Season 2: The Crossing"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={2}
                        className="resize-none"
                        data-test="create-season-description"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="directionNotes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Direction notes (optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={3}
                        className="resize-none"
                        placeholder="Short-form reels. Fast pacing, strong hooks in the first 3 seconds."
                        data-test="create-season-notes"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      The generators read these when writing this season&apos;s
                      episodes.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting}
                  data-test="create-season-submit"
                >
                  {isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Create season
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </>
  );
}
