'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Info, Loader2, Sparkles } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
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
import { useLlmJob } from '@kit/ui/hooks';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import {
  type EpisodeOutline,
  type GenerateSeasonOutlineInput,
  GenerateSeasonOutlineSchema,
} from '../../lib/schemas/batch-episode.schema';
import { updateSeasonAction } from '../../lib/server/mutations/season-actions';
import {
  batchCreateEpisodesAction,
  generateSeasonOutlineAction,
} from '../../server/batch-episode-actions';
import { EpisodePreviewDialog } from './episode-preview-dialog';

interface BatchEpisodeCreatorProps {
  projectId: string;
  seasonId?: string;
  existingEpisodeCount: number;
  onSuccess?: () => void;
}

const GENRE_OPTIONS = [
  { value: 'sci-fi', label: 'Science Fiction' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'drama', label: 'Drama' },
  { value: 'comedy', label: 'Comedy' },
  { value: 'thriller', label: 'Thriller' },
  { value: 'horror', label: 'Horror' },
  { value: 'romance', label: 'Romance' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'action', label: 'Action' },
  { value: 'mystery', label: 'Mystery' },
];

const STYLE_OPTIONS = [
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'documentary', label: 'Documentary' },
  { value: 'animated', label: 'Animated' },
  { value: 'noir', label: 'Noir' },
  { value: 'whimsical', label: 'Whimsical' },
  { value: 'gritty', label: 'Gritty' },
];

export function BatchEpisodeCreator({
  projectId,
  seasonId,
  existingEpisodeCount,
  onSuccess,
}: BatchEpisodeCreatorProps) {
  const [isPending, startTransition] = useTransition();
  const [isCreating, setIsCreating] = useState(false);
  const [seasonName, setSeasonName] = useState('');
  const [episodes, setEpisodes] = useState<EpisodeOutline[]>([]);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
  } = useLlmJob<{ episodes: EpisodeOutline[] }>('season-outline');

  // Handle async WebSocket result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // llmResult is already the result object from message.result (contains {success, data: {episodes}})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = (llmResult as any)?.data;
      if (resultData?.episodes) {
        setEpisodes(resultData.episodes);
        setIsPreviewOpen(true);
        toast.success(
          `Generated ${resultData.episodes.length} episode outlines`,
        );
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Failed to generate episode outlines');
    }
  }, [llmStatus, llmResult, llmError]);

  const form = useForm({
    resolver: zodResolver(GenerateSeasonOutlineSchema),
    defaultValues: {
      projectId,
      seasonId,
      seasonPremise: '',
      episodeCount: 6,
      startingNumber: existingEpisodeCount + 1,
      genre: undefined,
      style: undefined,
    },
  });

  const premiseValue = form.watch('seasonPremise');
  const premiseLength = premiseValue?.length ?? 0;
  const episodeCount = form.watch('episodeCount');

  const onSubmit = form.handleSubmit((data: GenerateSeasonOutlineInput) => {
    startTransition(async () => {
      try {
        const result = await unwrap(generateSeasonOutlineAction(data));

        if (result.success) {
          if (result.queued) {
            toast.info('Generating episodes in the background...');
          } else if (result.data) {
            setEpisodes(result.data.episodes);
            setIsPreviewOpen(true);
            toast.success(
              `Generated ${result.data.episodes.length} episode outlines`,
            );
          }
        }
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Failed to generate episode outlines'),
        );
      }
    });
  });

  const handleCreateEpisodes = async () => {
    if (episodes.length === 0) return;

    setIsCreating(true);
    try {
      // Update season name if provided and seasonId exists
      if (seasonId && seasonName.trim()) {
        try {
          await unwrap(
            updateSeasonAction({
              seasonId,
              name: seasonName.trim(),
            }),
          );
        } catch {
          toast.error('Failed to update season name');
          setIsCreating(false);
          return;
        }
      }

      const result = await unwrap(
        batchCreateEpisodesAction({
          projectId,
          seasonId,
          episodes,
        }),
      );

      if (result.success) {
        toast.success(`Created ${result.data.count} episodes`);
        setIsPreviewOpen(false);
        setEpisodes([]);
        setSeasonName('');
        form.reset({
          projectId,
          seasonId,
          seasonPremise: '',
          episodeCount: 6,
          startingNumber: existingEpisodeCount + result.data.count + 1,
          genre: undefined,
          style: undefined,
        });
        onSuccess?.();
      }
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to create episodes'));
    } finally {
      setIsCreating(false);
    }
  };

  const handleEpisodesChange = (updatedEpisodes: EpisodeOutline[]) => {
    setEpisodes(updatedEpisodes);
  };

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            <CardTitle>Batch Episode Creator</CardTitle>
          </div>
          <CardDescription>
            Generate multiple episode outlines at once with AI-powered story
            structure
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-6">
              {/* Season Name */}
              <div className="space-y-2">
                <FormLabel>Season Name</FormLabel>
                <Input
                  value={seasonName}
                  onChange={(e) => setSeasonName(e.target.value)}
                  placeholder="e.g., History Deep Dives, Science Reels, Season 3"
                />
                <FormDescription>
                  Organize episodes by content type
                </FormDescription>
              </div>

              <FormField
                control={form.control}
                name="seasonPremise"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Season Premise</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the overall premise for your season. What's the main story arc? What themes will you explore?"
                        className="min-h-[120px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex justify-between text-xs">
                      <FormDescription>
                        This will guide the AI in creating cohesive episode
                        outlines
                      </FormDescription>
                      <span
                        className={
                          premiseLength < 20
                            ? 'text-destructive'
                            : premiseLength > 1800
                              ? 'text-yellow-500'
                              : 'text-muted-foreground'
                        }
                      >
                        {premiseLength}/2000
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="genre"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Genre (Optional)</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select genre" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {GENRE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
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
                  name="style"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Visual Style (Optional)</FormLabel>
                      <Select
                        onValueChange={field.onChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select style" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {STYLE_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
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
                name="episodeCount"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Number of Episodes</FormLabel>
                      <span className="text-sm font-medium text-muted-foreground">
                        {field.value} episodes
                      </span>
                    </div>
                    <FormControl>
                      <Slider
                        min={2}
                        max={24}
                        step={1}
                        value={[field.value ?? 6]}
                        onValueChange={([value]) => field.onChange(value)}
                      />
                    </FormControl>
                    <FormDescription>
                      Generate between 2-24 episodes in a single batch
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Alert>
                <Info className="h-4 w-4" />
                <AlertTitle>Story Structure</AlertTitle>
                <AlertDescription>
                  Episodes will follow classic narrative structure: Setup (20%)
                  {' → '} Rising Action (30%) {' → '} Midpoint {' → '} Climax
                  Build (30%) {' → '} Resolution (20%)
                </AlertDescription>
              </Alert>

              <div className="flex justify-end">
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating {episodeCount} Episodes...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate {episodeCount} Episode Outlines
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <EpisodePreviewDialog
        open={isPreviewOpen}
        onOpenChange={setIsPreviewOpen}
        episodes={episodes}
        onEpisodesChange={handleEpisodesChange}
        onConfirm={handleCreateEpisodes}
        isPending={isCreating}
      />
    </>
  );
}
