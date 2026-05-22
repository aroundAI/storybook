'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronDown,
  Clock,
  Film,
  Loader2,
  MapPin,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { type UseFormReturn, useFieldArray, useForm } from 'react-hook-form';

import type { ContentStyle, Genre, VideoStyle } from '@kit/film-studio-schemas';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
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
import { Separator } from '@kit/ui/separator';
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import {
  type RecurringElement,
  type UpdateStudioSettingsInput,
  UpdateStudioSettingsSchema,
} from '../_lib/schemas/studio-settings.schema';
import { updateStudioSettingsAction } from '../_lib/server/update-studio-settings.action';

interface StudioSettingsFormProps {
  projectId: string;
  currentSettings: {
    description?: string;
    targetAudience?: string;
    genre?: Genre;
    videoStyle?: VideoStyle;
    contentStyle?: ContentStyle;
    defaultEpisodeDuration?: number;
    contentRating?: 'G' | 'PG' | 'PG-13' | 'R' | 'NR';
    language?: string;
    projectAestheticStyle?: string;
    recurringElements?: Array<{
      id?: string;
      name?: string;
      enabled?: boolean;
      location?: string;
      purpose?: string;
      placement?: 'beginning' | 'middle' | 'end' | 'throughout';
      dialogueHints?: string;
    }>;
  };
}

const GENRES: Array<{ value: Genre; label: string }> = [
  { value: 'kids', label: 'Kids & Family' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'drama', label: 'Drama' },
  { value: 'action', label: 'Action' },
  { value: 'educational', label: 'Educational' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'sci-fi', label: 'Sci-Fi' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'romance', label: 'Romance' },
  { value: 'thriller', label: 'Thriller' },
  { value: 'horror', label: 'Horror' },
  { value: 'general', label: 'General' },
];

const VIDEO_STYLES: Array<{ value: VideoStyle; label: string }> = [
  { value: 'cartoon', label: 'Cartoon' },
  { value: 'animated', label: 'Animated' },
  { value: 'anime', label: 'Anime' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'vlog', label: 'Vlog' },
  { value: 'commercial', label: 'Commercial' },
];

const CONTENT_STYLES: Array<{
  value: ContentStyle;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'dialogue-heavy',
    label: 'Dialogue Heavy',
    description: 'More dialogue lines per scene (kids cartoons, comedies)',
    icon: MessageSquare,
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Mix of dialogue and action (dramas, documentaries)',
    icon: Film,
  },
  {
    value: 'action-heavy',
    label: 'Action Heavy',
    description: 'Fewer dialogue lines, more visual storytelling',
    icon: Zap,
  },
];

const DURATION_PRESETS = [
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
  { value: 2700, label: '45 min' },
  { value: 3600, label: '1 hour' },
  { value: 5400, label: '90 min' },
  { value: 7200, label: '2 hours' },
];

const CONTENT_RATINGS = [
  { value: 'G', label: 'G - General Audience' },
  { value: 'PG', label: 'PG - Parental Guidance' },
  { value: 'PG-13', label: 'PG-13 - Parents Cautioned' },
  { value: 'R', label: 'R - Restricted' },
  { value: 'NR', label: 'NR - Not Rated' },
];

const PLACEMENT_OPTIONS = [
  {
    value: 'beginning',
    label: 'Beginning',
    description: 'Before the main story hook',
  },
  {
    value: 'middle',
    label: 'Middle',
    description: 'At a natural midpoint',
  },
  {
    value: 'end',
    label: 'End',
    description: 'As the final moment',
  },
  {
    value: 'throughout',
    label: 'Throughout',
    description: 'Multiple natural points',
  },
];

function createEmptyElement(): RecurringElement {
  return {
    id: crypto.randomUUID(),
    name: '',
    enabled: true,
    location: '',
    purpose: '',
    placement: 'end',
    dialogueHints: '',
  };
}

export function StudioSettingsForm({
  projectId,
  currentSettings,
}: StudioSettingsFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(UpdateStudioSettingsSchema),
    defaultValues: {
      projectId,
      description: currentSettings.description ?? '',
      targetAudience: currentSettings.targetAudience ?? '',
      genre: currentSettings.genre,
      videoStyle: currentSettings.videoStyle,
      contentStyle: currentSettings.contentStyle ?? 'dialogue-heavy',
      defaultEpisodeDuration: currentSettings.defaultEpisodeDuration ?? 300,
      contentRating: currentSettings.contentRating,
      language: currentSettings.language ?? 'en',
      projectAestheticStyle: currentSettings.projectAestheticStyle ?? '',
      recurringElements:
        currentSettings.recurringElements?.map((el) => ({
          id: el.id ?? crypto.randomUUID(),
          name: el.name ?? 'Recurring Element',
          enabled: el.enabled ?? false,
          location: el.location ?? '',
          purpose: el.purpose ?? '',
          placement: el.placement ?? ('end' as const),
          dialogueHints: el.dialogueHints ?? '',
        })) ?? [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'recurringElements',
  });

  const onSubmit = form.handleSubmit((data: UpdateStudioSettingsInput) => {
    startTransition(async () => {
      try {
        const result = await updateStudioSettingsAction(data);

        if (result.success) {
          toast.success('Settings updated successfully');
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to update settings',
        );
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        {/* Content Generation Settings Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              Content Generation Settings
            </CardTitle>
            <CardDescription>
              Configure how AI generates stories, screenplays, and shots for
              this project.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Content Profile */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Description</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Describe your project..."
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A brief description of your project shown on the overview
                    page.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="targetAudience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Audience</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Children ages 4-8" {...field} />
                  </FormControl>
                  <FormDescription>Who is this content for?</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Compact 2-column row: Genre + Content Rating */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="genre"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Genre</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a genre" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {GENRES.map((genre) => (
                          <SelectItem key={genre.value} value={genre.value}>
                            {genre.label}
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
                name="contentRating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content Rating</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a rating" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {CONTENT_RATINGS.map((rating) => (
                          <SelectItem key={rating.value} value={rating.value}>
                            {rating.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Compact 2-column row: Video Style + Language */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="videoStyle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Video Style</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a video style" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VIDEO_STYLES.map((style) => (
                          <SelectItem key={style.value} value={style.value}>
                            {style.label}
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
                name="language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Language</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                        <SelectItem value="fr">French</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <Separator />

            {/* Visual & Production */}
            <FormField
              control={form.control}
              name="contentStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content Style</FormLabel>
                  <div className="grid grid-cols-1 gap-3 pt-1 sm:grid-cols-3">
                    {CONTENT_STYLES.map((style) => {
                      const StyleIcon = style.icon;
                      return (
                        <button
                          key={style.value}
                          type="button"
                          onClick={() => field.onChange(style.value)}
                          className={cn(
                            'border-input hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors',
                            field.value === style.value &&
                              'bg-primary/10 border-primary ring-primary/20 ring-2',
                          )}
                        >
                          <StyleIcon
                            className={cn(
                              'h-6 w-6',
                              field.value === style.value
                                ? 'text-primary'
                                : 'text-muted-foreground',
                            )}
                          />
                          <span className="text-sm font-medium">
                            {style.label}
                          </span>
                          <span className="text-muted-foreground text-center text-xs">
                            {style.description}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="defaultEpisodeDuration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Default Episode Duration
                  </FormLabel>
                  <div className="flex flex-wrap gap-2 pt-1">
                    {DURATION_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() => field.onChange(preset.value)}
                        className={cn(
                          'border-input hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors',
                          field.value === preset.value &&
                            'bg-primary text-primary-foreground border-primary',
                        )}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                  <FormDescription>
                    Default duration for new episodes.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="projectAestheticStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <Film className="h-4 w-4" />
                    Project Aesthetic Style
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Noir-inspired with saturated colors, dramatic shadows, and whimsical undertones"
                      className="resize-none"
                      rows={3}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Visual aesthetic applied to all shot prompts for consistency
                    across the project.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Recurring Story Elements Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  Recurring Story Elements
                </CardTitle>
                <CardDescription>
                  Add signature scenes that appear in every episode. Use a
                  &quot;Beginning&quot; element for an establishing shot, or an
                  &quot;End&quot; element for a closing pattern.
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={fields.length >= 5}
                onClick={() => append(createEmptyElement())}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add Element
              </Button>
            </div>
          </CardHeader>

          {fields.length > 0 && (
            <CardContent className="space-y-3">
              {fields.map((field, index) => (
                <RecurringElementCard
                  key={field.id}
                  index={index}
                  form={form}
                  onRemove={() => remove(index)}
                />
              ))}
            </CardContent>
          )}

          {fields.length === 0 && (
            <CardContent>
              <div className="text-muted-foreground flex flex-col items-center gap-2 rounded-lg border border-dashed py-8 text-center text-sm">
                <RefreshCw className="h-8 w-8 opacity-40" />
                <p>No recurring elements configured.</p>
                <p className="text-xs">
                  Add an element to include signature scenes in every episode.
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Form-level Save button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}

function RecurringElementCard({
  index,
  form,
  onRemove,
}: {
  index: number;
  form: UseFormReturn<UpdateStudioSettingsInput>;
  onRemove: () => void;
}) {
  const name = form.watch(`recurringElements.${index}.name`) || 'Untitled';
  const enabled = form.watch(`recurringElements.${index}.enabled`);
  const placement = form.watch(`recurringElements.${index}.placement`);

  return (
    <Collapsible
      defaultOpen={!form.getValues(`recurringElements.${index}.name`)}
    >
      <div
        className={cn(
          'rounded-lg border transition-colors',
          enabled ? 'border-border' : 'border-border/50 opacity-60',
        )}
      >
        {/* Collapsed header */}
        <div className="flex items-center gap-3 px-4 py-3">
          <FormField
            control={form.control}
            name={`recurringElements.${index}.enabled`}
            render={({ field }) => (
              <Switch
                checked={field.value as boolean}
                onCheckedChange={field.onChange}
              />
            )}
          />

          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className="truncate text-sm font-medium">{name}</span>
              <span className="bg-muted text-muted-foreground shrink-0 rounded px-1.5 py-0.5 text-xs capitalize">
                {placement ?? 'end'}
              </span>
              <ChevronDown className="text-muted-foreground ml-auto h-4 w-4 shrink-0 transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </CollapsibleTrigger>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Expanded content */}
        <CollapsibleContent>
          <div className="space-y-4 border-t px-4 py-4">
            {/* Element Name */}
            <FormField
              control={form.control}
              name={`recurringElements.${index}.name`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Element Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Walk Home Segment, Opening Establishing Shot"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Placement */}
            <FormField
              control={form.control}
              name={`recurringElements.${index}.placement`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Placement in Episode</FormLabel>
                  <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-4">
                    {PLACEMENT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => field.onChange(option.value)}
                        className={cn(
                          'border-input hover:bg-accent flex flex-col items-start rounded-md border px-3 py-2 text-left transition-colors',
                          field.value === option.value &&
                            'bg-primary/10 border-primary ring-primary/20 ring-1',
                        )}
                      >
                        <span className="text-sm font-medium">
                          {option.label}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          {option.description}
                        </span>
                      </button>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Location / Context */}
            <FormField
              control={form.control}
              name={`recurringElements.${index}.location`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <MapPin className="h-4 w-4" />
                    Location / Context
                  </FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., The family dinner table"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Where does this scene take place?
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Purpose */}
            <FormField
              control={form.control}
              name={`recurringElements.${index}.purpose`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Purpose</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., The character reflects on their day and shares what they learned"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>What happens in this scene?</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Dialogue Hints */}
            <FormField
              control={form.control}
              name={`recurringElements.${index}.dialogueHints`}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Dialogue Hints (Optional)</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Use phrases like 'You know what I learned today...'"
                      className="resize-none"
                      rows={2}
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    Specific phrases or dialogue patterns to use.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
