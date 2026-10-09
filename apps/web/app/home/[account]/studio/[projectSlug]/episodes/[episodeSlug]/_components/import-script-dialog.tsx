'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import {
  type ImportScreenplayInput,
  ImportScreenplaySchema,
} from '@kit/episodes/schemas/create-episode-start';
import { importScreenplayAction } from '@kit/episodes/server/actions';
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
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

/**
 * FILM-2205: a finished script becomes this episode's screenplay, read as
 * the screenplay stage's scenes (Fountain, Final Draft or plain text).
 */
export function ImportScriptDialog({
  episodeId,
  version,
  open,
  onOpenChange,
  onImported,
}: {
  episodeId: string;
  version: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const defaults: ImportScreenplayInput = { episodeId, version, script: '' };

  const form = useForm({
    resolver: zodResolver(ImportScreenplaySchema),
    defaultValues: defaults,
  });

  async function onSubmit(data: ImportScreenplayInput) {
    try {
      const result = await unwrap(importScreenplayAction(data));

      toast.success(
        `Screenplay stored: ${result.scenes} ${result.scenes === 1 ? 'scene' : 'scenes'}`,
      );
      onOpenChange(false);
      onImported();
    } catch (error) {
      toast.error(refusalMessage(error, 'The script could not be stored'));
    }
  }

  async function readFile(file: File | undefined) {
    if (!file) return;

    form.setValue('script', await file.text(), {
      shouldValidate: true,
      shouldDirty: true,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Paste a script</DialogTitle>
          <DialogDescription>
            It becomes this episode&apos;s screenplay. Shots are generated from
            it as from any screenplay.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="script"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Script</FormLabel>
                  <FormControl>
                    <Textarea
                      className="min-h-56 font-mono text-xs"
                      data-test="import-script-text"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription className="flex items-center justify-between gap-2">
                    <span>Fountain, Final Draft (.fdx) or plain text.</span>
                    <label className="cursor-pointer text-primary underline-offset-2 hover:underline">
                      Choose a file
                      <input
                        type="file"
                        accept=".fountain,.spmd,.fdx,.txt,.md,text/plain"
                        className="sr-only"
                        data-test="import-script-file"
                        onChange={(event) =>
                          void readFile(event.target.files?.[0])
                        }
                      />
                    </label>
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                data-test="import-script-submit"
              >
                {form.formState.isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Store screenplay
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
