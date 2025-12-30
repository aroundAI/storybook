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
import { cn } from '@kit/ui/utils';
import { Label } from '@kit/ui/label';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

import {
  type UpdateStudioSettingsInput,
  UpdateStudioSettingsSchema,
} from '../_lib/schemas/studio-settings.schema';
import { updateStudioSettingsAction } from '../_lib/server/update-studio-settings.action';

interface StudioSettingsFormProps {
  projectId: string;
  currentSettings: {
    targetAudience?: string;
    genre?: Genre;
    videoStyle?: VideoStyle;
    contentStyle?: ContentStyle;
    defaultEpisodeDuration?: number;
    contentRating?: 'G' | 'PG' | 'PG-13' | 'R' | 'NR';
    language?: string;
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
      targetAudience: currentSettings.targetAudience ?? '',
      genre: currentSettings.genre,
      videoStyle: currentSettings.videoStyle,
      contentStyle: currentSettings.contentStyle ?? 'dialogue-heavy',
      defaultEpisodeDuration: currentSettings.defaultEpisodeDuration ?? 300,
      contentRating: currentSettings.contentRating,
      language: currentSettings.language ?? 'en',
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

  // TEST 2: With Form wrapper + FormField (minimal)
  return (
    <Form {...form}>
      <form onSubmit={onSubmit}>
        <Card>
          <CardHeader>
            <CardTitle>Content Generation Settings</CardTitle>
            <CardDescription>
              Testing with Form wrapper + FormField components.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="targetAudience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Audience</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Children ages 4-8"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Test description</FormDescription>
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
                  <FormControl>
                    <Input
                      placeholder="e.g., en"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>Second field</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
