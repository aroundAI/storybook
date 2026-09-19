'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Calendar, Loader2, Plus, Shield } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import type { ImmutableEventType } from '@kit/episodes';
import { addImmutableEventAction } from '@kit/episodes/server';
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

const EVENT_TYPES: {
  value: ImmutableEventType;
  label: string;
  description: string;
}[] = [
  {
    value: 'death',
    label: 'Death',
    description: 'Character death - cannot be reversed',
  },
  {
    value: 'world_fact',
    label: 'World Fact',
    description: 'Established fact about the world',
  },
  {
    value: 'relationship',
    label: 'Relationship',
    description: 'Key relationship established',
  },
  { value: 'timeline', label: 'Timeline', description: 'Fixed point in time' },
  {
    value: 'ability_loss',
    label: 'Ability Loss',
    description: 'Character loses an ability',
  },
  {
    value: 'location_destruction',
    label: 'Location Destruction',
    description: 'A location is destroyed',
  },
];

const addEventSchema = z.object({
  eventType: z.enum([
    'death',
    'world_fact',
    'relationship',
    'timeline',
    'ability_loss',
    'location_destruction',
  ]),
  eventKey: z.string().min(1, 'Event key is required').max(100),
  description: z
    .string()
    .min(10, 'Description must be at least 10 characters')
    .max(500),
});

type AddEventFormData = z.infer<typeof addEventSchema>;

interface AddEventDialogProps {
  projectId: string;
  episodeId: string;
  season: number;
  episodeNumber: number;
  onEventAdded?: () => void;
}

export function AddEventDialog({
  projectId,
  episodeId,
  season,
  episodeNumber,
  onEventAdded,
}: AddEventDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const form = useForm<AddEventFormData>({
    resolver: zodResolver(addEventSchema),
    defaultValues: {
      eventType: 'world_fact',
      eventKey: '',
      description: '',
    },
  });

  const onSubmit = (data: AddEventFormData) => {
    startTransition(async () => {
      try {
        const result = await addImmutableEventAction({
          projectId,
          season,
          episodeNumber,
          eventType: data.eventType,
          eventKey: data.eventKey,
          description: data.description,
          establishedIn: episodeId,
        });

        if (result) {
          toast.success('Immutable event added successfully');
          form.reset();
          setOpen(false);
          onEventAdded?.();
        } else {
          toast.error('Failed to add event');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to add event',
        );
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Plus className="mr-1 h-3 w-3" />
          Add Event
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-violet-500" />
            Add Immutable Event
          </DialogTitle>
          <DialogDescription>
            Create a canon event that cannot be contradicted in future story
            generation.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="eventType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select event type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {EVENT_TYPES.map((type) => (
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
              name="eventKey"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Event Key</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., character_name_death, location_destroyed"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A unique identifier for this event (use underscores)
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
                  <FormLabel>Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe what happened and why it's immutable..."
                      className="min-h-[100px]"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    This will be used as context for LLM generation
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex items-center gap-2 rounded-lg bg-muted/50 p-3 text-sm">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">
                Season {season}, Episode {episodeNumber}
              </span>
            </div>

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
                    Adding...
                  </>
                ) : (
                  'Add Event'
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
