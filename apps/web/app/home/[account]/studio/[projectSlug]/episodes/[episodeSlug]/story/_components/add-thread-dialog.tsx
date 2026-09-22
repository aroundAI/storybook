'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { GitBranch, Loader2, Plus } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { NarrativeThreadType } from '@kit/episodes';
import { createNarrativeThreadAction } from '@kit/episodes/server';
import { refusalMessage } from '@kit/next/action-result';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

const THREAD_TYPES: {
  value: NarrativeThreadType;
  label: string;
  description: string;
}[] = [
  { value: 'plot', label: 'Plot', description: 'Main storyline thread' },
  {
    value: 'character',
    label: 'Character',
    description: 'Character development arc',
  },
  {
    value: 'mystery',
    label: 'Mystery',
    description: 'Unanswered question or puzzle',
  },
  {
    value: 'romantic',
    label: 'Romantic',
    description: 'Relationship development',
  },
  {
    value: 'conflict',
    label: 'Conflict',
    description: 'Ongoing conflict or tension',
  },
  {
    value: 'thematic',
    label: 'Thematic',
    description: 'Recurring theme exploration',
  },
];

const addThreadSchema = z.object({
  threadName: z.string().min(1, 'Thread name is required').max(100),
  threadType: z.enum([
    'plot',
    'character',
    'mystery',
    'romantic',
    'conflict',
    'thematic',
  ]),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500),
  promises: z.string().optional(),
});

type AddThreadFormData = z.infer<typeof addThreadSchema>;

interface AddThreadDialogProps {
  projectId: string;
  episodeId: string;
  onThreadAdded?: () => void;
}

export function AddThreadDialog({
  projectId,
  episodeId,
  onThreadAdded,
}: AddThreadDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AddThreadFormData>({
    resolver: zodResolver(addThreadSchema),
    defaultValues: {
      threadName: '',
      threadType: 'plot',
      description: '',
      promises: '',
    },
  });

  const onSubmit = (data: AddThreadFormData) => {
    startTransition(async () => {
      try {
        const promises = data.promises
          ? data.promises.split('\n').filter((p) => p.trim())
          : [];

        const result = await createNarrativeThreadAction({
          projectId,
          threadName: data.threadName,
          threadType: data.threadType,
          description: data.description,
          openedAt: episodeId,
          promises,
        });

        if (result) {
          toast.success('Narrative thread created successfully');
          form.reset();
          setOpen(false);
          onThreadAdded?.();
        } else {
          toast.error('Failed to create thread');
        }
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to create thread'));
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3 w-3" />
          Add Thread
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-5 w-5 text-blue-500" />
            Create Narrative Thread
          </DialogTitle>
          <DialogDescription>
            Track a storyline, mystery, or character arc that spans multiple
            episodes.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="threadName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Thread Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., The Missing Artifact, John's Redemption"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="threadType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Thread Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select thread type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {THREAD_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex flex-col">
                            <span>{type.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {type.description}
                            </span>
                          </div>
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
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe the thread and its significance..."
                      className="min-h-[80px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="promises"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Promises (optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Enter setup/promises that need payoffs (one per line)"
                      className="min-h-[60px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Track setups that need to be paid off later
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
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Thread'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
