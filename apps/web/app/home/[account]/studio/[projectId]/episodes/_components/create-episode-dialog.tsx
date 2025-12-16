'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { CreateEpisodeSchema } from '@kit/episodes/schemas';
import { createEpisodeAction } from '@kit/episodes/server/actions';
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
import { Textarea } from '@kit/ui/textarea';

interface CreateEpisodeDialogProps {
  projectId: string;
  account: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerButton?: boolean;
}

export function CreateEpisodeDialog({
  projectId,
  account,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerButton = true,
}: CreateEpisodeDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);

  // Use controlled state if provided, otherwise use internal state
  const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen;

  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(CreateEpisodeSchema),
    defaultValues: {
      projectId,
      title: '',
      description: '',
    },
  });

  const isSubmitting = form.formState.isSubmitting;

  async function onSubmit(data: { title: string; description?: string }) {
    try {
      const result = await createEpisodeAction({
        projectId,
        title: data.title,
        description: data.description,
      });

      if (result.success && result.data) {
        toast.success('Episode created successfully');
        setIsOpen(false);
        form.reset();
        // Navigate to the new episode workspace
        router.push(
          `/home/${account}/studio/${projectId}/episodes/${result.data.id}`,
        );
      } else {
        toast.error('Failed to create episode');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create episode',
      );
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      {triggerButton && (
        <DialogTrigger asChild>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Create Episode
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create New Episode</DialogTitle>
          <DialogDescription>
            Add a new episode to your project. The episode number will be
            assigned automatically.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Title</FormLabel>
                  <FormControl>
                    <Input placeholder="Episode title" {...field} />
                  </FormControl>
                  <FormDescription>
                    Give your episode a descriptive title
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Brief description of the episode..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
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
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create Episode
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
