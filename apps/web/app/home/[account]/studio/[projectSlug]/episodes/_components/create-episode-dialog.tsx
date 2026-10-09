'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { FileText, Film, Lightbulb, Loader2, Plus } from 'lucide-react';
import { useForm, useWatch } from 'react-hook-form';

import {
  type CreateEpisodeStartInput,
  CreateEpisodeStartSchema,
  type StartFrom,
} from '@kit/episodes/schemas/create-episode-start';
import { createEpisodeStartAction } from '@kit/episodes/server/actions';
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
import { RadioGroup, RadioGroupItem } from '@kit/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

export interface SeasonOption {
  id: string;
  name: string;
  number: number;
}

interface CreateEpisodeDialogProps {
  projectId: string;
  projectSlug: string;
  account: string;
  seasons?: SeasonOption[];
  /** The season the episode goes in; null for Unsorted */
  defaultSeasonId?: string | null;
  defaultStartFrom?: StartFrom;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  triggerButton?: boolean;
}

const UNSORTED = 'unsorted';

const TILES: Array<{
  value: StartFrom;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'idea',
    label: 'From an idea',
    hint: "We'll help you build the story.",
    icon: Lightbulb,
  },
  {
    value: 'script',
    label: 'From a script',
    hint: 'Paste or upload a screenplay.',
    icon: FileText,
  },
  {
    value: 'video',
    label: 'From a finished video',
    hint: 'Upload a file, or link a published one.',
    icon: Film,
  },
];

/**
 * FILM-2205: a new episode starts from what the creator has. An idea opens
 * Ideation, as before; a script is stored as the screenplay; a finished
 * video opens Publish to attach it. Every other stage stays reachable.
 */
export function CreateEpisodeDialog({
  projectId,
  projectSlug,
  account,
  seasons = [],
  defaultSeasonId = null,
  defaultStartFrom = 'idea',
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  triggerButton = true,
}: CreateEpisodeDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlledOpen ?? internalOpen;
  const setIsOpen = controlledOnOpenChange ?? setInternalOpen;
  const router = useRouter();

  const defaults = () =>
    ({
      projectId,
      seasonId: defaultSeasonId,
      title: '',
      description: '',
      startFrom: defaultStartFrom,
    }) as CreateEpisodeStartInput;

  // A discriminated union: inference from the defaults would fix the form to
  // the idea branch, so the type is named
  const form = useForm<CreateEpisodeStartInput>({
    resolver: zodResolver(CreateEpisodeStartSchema),
    defaultValues: defaults(),
  });

  const startFrom = useWatch({ control: form.control, name: 'startFrom' });
  const isSubmitting = form.formState.isSubmitting;

  function onOpenChange(next: boolean) {
    // A dialog opened from a season starts in that season, every time
    if (next) form.reset(defaults());
    setIsOpen(next);
  }

  async function onSubmit(data: CreateEpisodeStartInput) {
    try {
      const result = await unwrap(createEpisodeStartAction(data));
      const base = `/home/${account}/studio/${projectSlug}/episodes/${result.slug}`;

      toast.success('Episode created');
      setIsOpen(false);
      form.reset(defaults());
      // The episode root opens Ideation; the others open their stage
      router.push(
        result.landing === 'ideation' ? base : `${base}/${result.landing}`,
      );
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to create episode'));
    }
  }

  async function readScriptFile(file: File | undefined) {
    if (!file) return;

    form.setValue('script', await file.text(), {
      shouldValidate: true,
      shouldDirty: true,
    });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {triggerButton && (
        <DialogTrigger asChild>
          <Button data-test="create-episode-trigger">
            <Plus className="mr-2 h-4 w-4" />
            Create Episode
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>New episode</DialogTitle>
          <DialogDescription>
            Start from whatever you have. The episode number is assigned
            automatically.
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
                    <Input
                      data-test="create-episode-title"
                      placeholder="Episode title"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="seasonId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Season</FormLabel>
                  <Select
                    value={field.value ?? UNSORTED}
                    onValueChange={(value) =>
                      field.onChange(value === UNSORTED ? null : value)
                    }
                  >
                    <FormControl>
                      <SelectTrigger data-test="create-episode-season">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={UNSORTED}>
                        No season (Unsorted)
                      </SelectItem>
                      {seasons.map((season) => (
                        <SelectItem key={season.id} value={season.id}>
                          Season {season.number}
                          {season.name ? ` · ${season.name}` : ''}
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
              name="startFrom"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>How do you want to start?</FormLabel>
                  <FormControl>
                    <RadioGroup
                      value={field.value}
                      onValueChange={field.onChange}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-3"
                    >
                      {TILES.map((tile) => (
                        <label
                          key={tile.value}
                          htmlFor={`start-from-${tile.value}`}
                          className={cn(
                            'flex cursor-pointer flex-col gap-1 rounded-lg border p-3 text-sm transition-colors hover:border-primary/60',
                            field.value === tile.value &&
                              'border-primary bg-primary/5',
                          )}
                        >
                          <span className="flex items-center gap-2 font-medium">
                            <RadioGroupItem
                              id={`start-from-${tile.value}`}
                              value={tile.value}
                              data-test={`start-from-${tile.value}`}
                            />
                            <tile.icon className="h-4 w-4" />
                            {tile.label}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {tile.hint}
                          </span>
                        </label>
                      ))}
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {startFrom === 'script' && (
              <FormField
                control={form.control}
                name="script"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Script</FormLabel>
                    <FormControl>
                      <Textarea
                        data-test="create-episode-script"
                        placeholder={
                          'INT. LIGHTHOUSE - NIGHT\n\nRain on the glass.\n\nMARA\nThe tide is turning.'
                        }
                        className="min-h-40 font-mono text-xs"
                        {...field}
                        value={field.value ?? ''}
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
                          data-test="create-episode-script-file"
                          onChange={(event) =>
                            void readScriptFile(event.target.files?.[0])
                          }
                        />
                      </label>
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {startFrom === 'video' && (
              <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                The episode opens on Publish, where you upload the video or
                paste a link to it. You can still write a story or screenplay
                for it later.
              </p>
            )}

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
                data-test="create-episode-submit"
                disabled={isSubmitting}
              >
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
