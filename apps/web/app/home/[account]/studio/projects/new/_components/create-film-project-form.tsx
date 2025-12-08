'use client';

import { useEffect, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import type { TargetPlatform } from '@kit/film-studio-schemas/project';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
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

import {
  CreateFilmProjectSchema,
  PLATFORM_CONFIGS,
  getSmartDefaults,
} from '../_lib/schema';
import { createFilmProjectAndRedirect } from '../_lib/server/create-film-project.action';

type FormData = z.infer<typeof CreateFilmProjectSchema>;

interface CreateFilmProjectFormProps {
  accountSlug: string;
}

const PROJECT_TYPES = [
  {
    value: 'short-film',
    label: 'Short Film',
    description: 'Standalone short-form content',
  },
  {
    value: 'series',
    label: 'Series',
    description: 'Multi-episode content',
  },
  {
    value: 'documentary',
    label: 'Documentary',
    description: 'Non-fiction storytelling',
  },
  {
    value: 'ad',
    label: 'Advertisement',
    description: 'Commercial or promotional content',
  },
  {
    value: 'educational',
    label: 'Educational',
    description: 'Learning or tutorial content',
  },
] as const;

const VIDEO_STYLES = [
  {
    value: 'realistic',
    label: 'Realistic',
    description: 'Photorealistic imagery',
  },
  {
    value: 'cinematic',
    label: 'Cinematic',
    description: 'Film-quality production',
  },
  { value: 'animated', label: 'Animated', description: '3D animation style' },
  { value: 'cartoon', label: 'Cartoon', description: '2D cartoon style' },
  { value: 'anime', label: 'Anime', description: 'Japanese anime style' },
  {
    value: 'documentary',
    label: 'Documentary',
    description: 'Documentary-style footage',
  },
  { value: 'vlog', label: 'Vlog', description: 'Casual vlog aesthetic' },
  {
    value: 'commercial',
    label: 'Commercial',
    description: 'Polished advertising style',
  },
] as const;

const ASPECT_RATIOS = [
  { value: '16:9', label: '16:9 (Landscape)', description: 'YouTube, TV' },
  { value: '9:16', label: '9:16 (Portrait)', description: 'TikTok, Reels' },
  { value: '1:1', label: '1:1 (Square)', description: 'Instagram Feed' },
  { value: '4:5', label: '4:5 (Vertical)', description: 'Instagram Stories' },
  { value: '4:3', label: '4:3 (Standard)', description: 'Classic TV' },
  { value: '21:9', label: '21:9 (Cinema)', description: 'Widescreen' },
] as const;

const VIDEO_PROVIDERS = [
  {
    value: 'kling',
    label: 'Kling AI',
    description: 'Fast, high-quality generations',
  },
  {
    value: 'runway',
    label: 'Runway ML',
    description: 'Premium cinematic quality',
  },
  {
    value: 'luma',
    label: 'Luma AI',
    description: 'Natural motion, great for scenes',
  },
] as const;

const AUDIO_PROVIDERS = [
  {
    value: 'elevenlabs',
    label: 'ElevenLabs',
    description: 'Natural voice synthesis',
  },
  { value: 'suno', label: 'Suno', description: 'Music and audio generation' },
] as const;

const CONTENT_RATINGS = [
  { value: 'G', label: 'G - General Audiences' },
  { value: 'PG', label: 'PG - Parental Guidance' },
  { value: 'PG-13', label: 'PG-13 - Parents Strongly Cautioned' },
  { value: 'R', label: 'R - Restricted' },
  { value: 'NR', label: 'NR - Not Rated' },
] as const;

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
] as const;

export function CreateFilmProjectForm({
  accountSlug,
}: CreateFilmProjectFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(CreateFilmProjectSchema),
    defaultValues: {
      name: '',
      description: '',
      settings: {
        projectType: 'short-film' as const,
        targetPlatforms: ['youtube'] as (
          | 'youtube'
          | 'tiktok'
          | 'instagram'
          | 'facebook'
          | 'twitter'
          | 'linkedin'
          | 'custom'
        )[],
        videoStyle: 'cinematic' as const,
        defaultAspectRatio: '16:9',
        defaultDuration: 5,
        defaultProvider: 'kling' as const,
        audioProvider: undefined,
        targetAudience: '',
        contentRating: undefined,
        language: 'en',
        subtitlesEnabled: false,
      },
    },
  });

  // Watch platforms to apply smart defaults
  const targetPlatforms = useWatch({
    control: form.control,
    name: 'settings.targetPlatforms',
  });

  // Apply smart defaults when platforms change
  useEffect(() => {
    if (targetPlatforms && targetPlatforms.length > 0) {
      const defaults = getSmartDefaults(targetPlatforms);
      form.setValue('settings.defaultAspectRatio', defaults.defaultAspectRatio);
      form.setValue('settings.defaultDuration', defaults.defaultDuration);
    }
  }, [targetPlatforms, form]);

  const onSubmit = form.handleSubmit((data: FormData) => {
    startTransition(async () => {
      try {
        await createFilmProjectAndRedirect(accountSlug, {
          name: data.name,
          description: data.description,
          settings: data.settings,
        });
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : 'Failed to create project',
        );
      }
    });
  });

  const togglePlatform = (platform: TargetPlatform) => {
    const current = form.getValues('settings.targetPlatforms') || [];
    const newPlatforms = current.includes(platform)
      ? current.filter((p: TargetPlatform) => p !== platform)
      : [...current, platform];

    // Ensure at least one platform is selected
    if (newPlatforms.length > 0) {
      form.setValue('settings.targetPlatforms', newPlatforms, {
        shouldValidate: true,
      });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-8">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
            <CardDescription>Core project details</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Name</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="My Awesome Film"
                      disabled={isPending}
                      data-test="project-name-input"
                    />
                  </FormControl>
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
                      {...field}
                      placeholder="A brief description of your project..."
                      disabled={isPending}
                      rows={3}
                      data-test="project-description-input"
                    />
                  </FormControl>
                  <FormDescription>
                    Optional. Describe what this project is about.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Project Type & Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Project Type & Distribution</CardTitle>
            <CardDescription>
              Define your project type and target platforms
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="settings.projectType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Project Type</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger data-test="project-type-select">
                        <SelectValue placeholder="Select project type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PROJECT_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          <div className="flex flex-col">
                            <span>{type.label}</span>
                            <span className="text-muted-foreground text-xs">
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
              name="settings.targetPlatforms"
              render={() => (
                <FormItem>
                  <FormLabel>Target Platforms</FormLabel>
                  <FormDescription>
                    Select one or more platforms where this content will be
                    published
                  </FormDescription>
                  <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
                    {Object.entries(PLATFORM_CONFIGS).map(([key, config]) => {
                      const platformKey = key as TargetPlatform;
                      const isSelected = (
                        form.getValues('settings.targetPlatforms') || []
                      ).includes(platformKey);
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => togglePlatform(platformKey)}
                          disabled={isPending}
                          className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-colors ${
                            isSelected
                              ? 'border-primary bg-primary/10'
                              : 'border-border hover:border-primary/50'
                          }`}
                          data-test={`platform-${key}`}
                        >
                          <span className="font-medium">{config.label}</span>
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
              name="settings.videoStyle"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Video Style</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    disabled={isPending}
                  >
                    <FormControl>
                      <SelectTrigger data-test="video-style-select">
                        <SelectValue placeholder="Select video style" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {VIDEO_STYLES.map((style) => (
                        <SelectItem key={style.value} value={style.value}>
                          <div className="flex flex-col">
                            <span>{style.label}</span>
                            <span className="text-muted-foreground text-xs">
                              {style.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose the visual style for your content
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Default Generation Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Default Generation Settings</CardTitle>
            <CardDescription>
              Set default values for video and audio generation
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="settings.defaultAspectRatio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Aspect Ratio</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-test="aspect-ratio-select">
                          <SelectValue placeholder="Select aspect ratio" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ASPECT_RATIOS.map((ratio) => (
                          <SelectItem key={ratio.value} value={ratio.value}>
                            <div className="flex flex-col">
                              <span>{ratio.label}</span>
                              <span className="text-muted-foreground text-xs">
                                {ratio.description}
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
                name="settings.defaultDuration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Shot Duration (seconds)</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="number"
                        min={1}
                        max={20}
                        disabled={isPending}
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value, 10) || 5)
                        }
                        data-test="duration-input"
                      />
                    </FormControl>
                    <FormDescription>1-20 seconds per shot</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="settings.defaultProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Default Video Provider</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-test="video-provider-select">
                          <SelectValue placeholder="Select video provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VIDEO_PROVIDERS.map((provider) => (
                          <SelectItem
                            key={provider.value}
                            value={provider.value}
                          >
                            <div className="flex flex-col">
                              <span>{provider.label}</span>
                              <span className="text-muted-foreground text-xs">
                                {provider.description}
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
                name="settings.audioProvider"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Audio Provider (Optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-test="audio-provider-select">
                          <SelectValue placeholder="Select audio provider" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {AUDIO_PROVIDERS.map((provider) => (
                          <SelectItem
                            key={provider.value}
                            value={provider.value}
                          >
                            <div className="flex flex-col">
                              <span>{provider.label}</span>
                              <span className="text-muted-foreground text-xs">
                                {provider.description}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Default provider for voice and audio generation
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Content Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Content Settings</CardTitle>
            <CardDescription>Additional content metadata</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="settings.targetAudience"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Target Audience (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="e.g., Young adults 18-35, Tech enthusiasts"
                      disabled={isPending}
                      data-test="target-audience-input"
                    />
                  </FormControl>
                  <FormDescription>
                    Describe your target audience
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="settings.contentRating"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content Rating (Optional)</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-test="content-rating-select">
                          <SelectValue placeholder="Select content rating" />
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

              <FormField
                control={form.control}
                name="settings.language"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Content Language</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={isPending}
                    >
                      <FormControl>
                        <SelectTrigger data-test="language-select">
                          <SelectValue placeholder="Select language" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {LANGUAGES.map((lang) => (
                          <SelectItem key={lang.value} value={lang.value}>
                            {lang.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="settings.subtitlesEnabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start gap-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={isPending}
                      data-test="subtitles-checkbox"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Enable Subtitles</FormLabel>
                    <FormDescription>
                      Automatically generate subtitles for videos
                    </FormDescription>
                  </div>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isPending}
            data-test="create-project-submit"
          >
            {isPending ? 'Creating...' : 'Create Project'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
