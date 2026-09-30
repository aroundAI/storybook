'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Pencil, User } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { updateCharacterStateAction } from '@kit/episodes/server';
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
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

const updateStateSchema = z.object({
  state: z.string().trim().min(1, 'Describe the new state').max(200),
  triggerEvent: z.string().trim().min(1, 'Say what caused it').max(300),
});

interface UpdateCharacterStateDialogProps {
  characterId: string;
  characterName: string;
  stateType: string;
  episodeId: string;
  onUpdated: () => void;
}

/**
 * Character states are append-only: this records a new state of the same
 * type after the current one, with what caused it. The earlier state stays.
 */
export function UpdateCharacterStateDialog({
  characterId,
  characterName,
  stateType,
  episodeId,
  onUpdated,
}: UpdateCharacterStateDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(updateStateSchema),
    defaultValues: { state: '', triggerEvent: '' },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        await unwrap(
          updateCharacterStateAction({
            characterId,
            episodeId,
            stateType: stateType as Parameters<
              typeof updateCharacterStateAction
            >[0]['stateType'],
            stateValue: { state: data.state },
            triggerEvent: data.triggerEvent,
          }),
        );
        toast.success('Character state recorded');
        form.reset();
        setOpen(false);
        onUpdated();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to update character state'));
      }
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground"
          aria-label="Record a new state"
          data-test="canon-character-state-edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-emerald-500" />
            {characterName}: new {stateType} state
          </DialogTitle>
          <DialogDescription>
            States are never overwritten. This adds the next one; the earlier
            state stays in the history.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-4">
            <FormField
              control={form.control}
              name="state"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>New state</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. grieving"
                      data-test="canon-character-state-value"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="triggerEvent"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>What caused it</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g. Her brother dies"
                      data-test="canon-character-state-trigger"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Recorded with the change so it can be audited.
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
                data-test="canon-character-state-submit"
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Record state
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
