'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  Clock,
  Film,
  Loader2,
  MapPin,
  MessageSquare,
  RefreshCw,
  Zap,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

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
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';
import { cn } from '@kit/ui/utils';

import {
  type UpdateStudioSettingsInput,
  UpdateStudioSettingsSchema,
} from '../_lib/schemas/studio-settings.schema';
import { updateStudioSettingsAction } from '../_lib/server/update-studio-settings.action';

interface StudioSettingsFormProps {
  projectId: string;
  currentSettings: {
    description?: string; // Project description
    targetAudience?: string;
    genre?: Genre;
    videoStyle?: VideoStyle;
    contentStyle?: ContentStyle;
    defaultEpisodeDuration?: number;
    contentRating?: 'G' | 'PG' | 'PG-13' | 'R' | 'NR';
    language?: string;
    projectAestheticStyle?: string;
    recurringElement?: {
      enabled?: boolean;
      location?: string;
      purpose?: string;
      placement?: 'beginning' | 'middle' | 'end' | 'throughout';
      dialogueHints?: string;
    };
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
  { value: 'beginning', label: 'Beginning' },
  { value: 'middle', label: 'Middle' },
  { value: 'end', label: 'End' },
  { value: 'throughout', label: 'Throughout' },
];

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
      recurringElement: {
        enabled: currentSettings.recurringElement?.enabled ?? false,
        location: currentSettings.recurringElement?.location ?? '',
        purpose: currentSettings.recurringElement?.purpose ?? '',
        placement: currentSettings.recurringElement?.placement ?? 'end',
        dialogueHints: currentSettings.recurringElement?.dialogueHints ?? '',
      },
    },
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

  // TEST 3: With Form wrapper + FormField + Select components
  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Content Generation Settings</CardTitle>
            <CardDescription>Testing with Select components.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Project Description */}
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
                  <FormDescription>Genre affects story themes.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                  <FormDescription>Visual style.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Content Style - button grid */}
            <FormField
              control={form.control}
              name="contentStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Content Style</FormLabel>
                  <div className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-3">
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

            {/* Default Episode Duration - button list */}
            <FormField
              control={form.control}
              name="defaultEpisodeDuration"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Default Episode Duration
                  </FormLabel>
                  <div className="flex flex-wrap gap-2 pt-2">
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

            {/* Content Rating */}
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
                  <FormDescription>Target content rating.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Language */}
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
                  <FormDescription>Primary language.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Project Aesthetic Style */}
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

        {/* Recurring Story Element Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <RefreshCw className="h-5 w-5" />
                  Recurring Story Element
                </CardTitle>
                <CardDescription>
                  Add a signature scene that appears in every episode.
                </CardDescription>
              </div>
              <FormField
                control={form.control}
                name="recurringElement.enabled"
                render={({ field }) => (
                  <Switch
                    checked={field.value}
                    onCheckedChange={field.onChange}
                  />
                )}
              />
            </div>
          </CardHeader>
          {form.watch('recurringElement.enabled') && (
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="recurringElement.location"
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
              <FormField
                control={form.control}
                name="recurringElement.purpose"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Purpose</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="e.g., The character reflects on their day"
                        className="resize-none"
                        rows={2}
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      What happens in this scene?
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recurringElement.placement"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Placement in Episode</FormLabel>
                    <div className="flex flex-wrap gap-2 pt-2">
                      {PLACEMENT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => field.onChange(option.value)}
                          className={cn(
                            'border-input hover:bg-accent rounded-md border px-3 py-1.5 text-sm transition-colors',
                            field.value === option.value &&
                              'bg-primary text-primary-foreground border-primary',
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="recurringElement.dialogueHints"
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
            </CardContent>
          )}
        </Card>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Settings
          </Button>
        </div>
      </form>
    </Form>
  );
}
