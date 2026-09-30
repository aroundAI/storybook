'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { GitBranch, Loader2, Pencil } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { NarrativeThread } from '@kit/episodes';
import { updateNarrativeThreadAction } from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'progressed', label: 'Progressed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'abandoned', label: 'Abandoned' },
] as const;

const editThreadSchema = z.object({
  status: z.enum(['open', 'progressed', 'resolved', 'abandoned']),
  payoffs: z.string().max(1000),
});

interface EditThreadDialogProps {
  thread: NarrativeThread;
  episodeId: string;
  onUpdated: () => void;
}

/**
 * Changes a thread's status and adds payoffs. A thread is never deleted:
 * abandoning it keeps its history for the audit log and for continuity.
 */
export function EditThreadDialog({
  thread,
  episodeId,
  onUpdated,
}: EditThreadDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(editThreadSchema),
    defaultValues: { status: thread.status, payoffs: '' },
  });

  const onSubmit = form.handleSubmit((data) => {
    if (thread.version === undefined) {
      toast.error('Reload the page: this thread has no version to edit.');
      return;
    }

    const payoffs = data.payoffs
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    startTransition(async () => {
      try {
        await unwrap(
          updateNarrativeThreadAction({
            threadId: thread.id,
            expectedVersion: thread.version!,
            status: data.status,
            ...(payoffs.length > 0 ? { payoffs } : {}),
            ...(data.status === 'resolved' ? { resolvedAt: episodeId } : {}),
          }),
        );
        toast.success('Thread updated');
        setOpen(false);
        onUpdated();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to update thread'));
      }
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) form.reset({ status: thread.status, payoffs: '' });
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          aria-label="Edit thread"
          data-test="canon-thread-edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-500" />
            Edit thread
          </DialogTitle>
          <DialogDescription>{thread.threadName}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="status"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger data-test="canon-thread-status">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {STATUSES.map((status) => (
                        <SelectItem key={status.value} value={status.value}>
                          {status.label}
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
              name="payoffs"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payoffs (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="What paid off a promise, one per line"
                      className="min-h-[70px]"
                      data-test="canon-thread-payoffs"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Added to the payoffs already recorded.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isPending}
                data-test="canon-thread-edit-submit"
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Save
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
