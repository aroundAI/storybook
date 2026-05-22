'use client';

import { useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ChevronDown,
  Loader2,
  Maximize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import { DurationSelector } from '@kit/episodes/components';
import type { ContentStyle } from '@kit/episodes/lib';
import {
  type GenerateStoryIdeasInput,
  GenerateStoryIdeasSchema,
} from '@kit/episodes/schemas';
import { generateStoryIdeasAction } from '@kit/episodes/server';
import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { Button } from '@kit/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@kit/ui/collapsible';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { useLlmJob } from '@kit/ui/hooks';
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import { useEpisodeContext } from '../../_components/episode-context-provider';
import { IdeaCard } from './idea-card';
import { RefineIdeaModal, type RefinedStoryIdea } from './refine-idea-modal';

interface IdeationScreenProps {
  episodeId: string;
  onComplete: (selection: RefinedStoryIdea) => void;
  initialPremise?: string;
  characterIds?: string[];
  locationIds?: string[];
  defaultDuration?: number;
  defaultContentStyle?: ContentStyle;
}

export function IdeationScreen({
  episodeId,
  onComplete,
  initialPremise = '',
  characterIds = [],
  locationIds = [],
  defaultDuration = 300,
  defaultContentStyle = 'dialogue-heavy',
}: IdeationScreenProps) {
  const { isGenerating, setIsGenerating } = useEpisodeContext();
  const [isPending, _startTransition] = useTransition();
  const [ideas, setIdeas] = useState<StoryIdea[]>([]);
  const [_hasGenerated, setHasGenerated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Modal state for refining a selected idea
  const [refineIdea, setRefineIdea] = useState<StoryIdea | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Duration and content style state
  const [targetDuration, setTargetDuration] = useState(defaultDuration);
  const [contentStyle, setContentStyle] =
    useState<ContentStyle>(defaultContentStyle);

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
    trigger: triggerLlm,
  } = useLlmJob<{ ideas: StoryIdea[] }>('story-ideation');

  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      const resultData = llmResult as { data?: { ideas: StoryIdea[] } };
      if (resultData.data?.ideas) {
        setIdeas(resultData.data.ideas);
        setHasGenerated(true);
        toast.success(`Generated ${resultData.data.ideas.length} story ideas`);
      }
    } else if (llmStatus === 'error') {
      toast.error(llmError || 'Failed to generate story ideas');
    }
  }, [llmStatus, llmResult, llmError]);

  const form = useForm({
    resolver: zodResolver(GenerateStoryIdeasSchema),
    defaultValues: {
      episodeId,
      premise: initialPremise,
      numberOfIdeas: 3,
    },
  });

  const premiseValue = form.watch('premise');
  const premiseLength = premiseValue?.length ?? 0;
  const numberOfIdeas = form.watch('numberOfIdeas');

  const onSubmit = form.handleSubmit((data: GenerateStoryIdeasInput) => {
    triggerLlm(async () => {
      const result = await generateStoryIdeasAction(data);
      // If local dev (synchronous), process immediately
      if (result.success && result.data) {
        setIdeas(result.data.ideas);
        setHasGenerated(true);
        toast.success(`Generated ${result.data.ideas.length} story ideas`);
        return { success: true, data: result.data };
      }
      // If queued, return queued flag (WebSocket will deliver result)
      if (result?.queued) {
        toast.info('Generating story ideas in background...');
        return { success: true, queued: true };
      }
      throw new Error('Failed to generate story ideas');
    });
  });

  const handleCardClick = (idea: StoryIdea) => {
    setRefineIdea(idea);
    setModalOpen(true);
  };

  const handleRefineComplete = (refined: RefinedStoryIdea) => {
    setModalOpen(false);
    setIsGenerating(true);
    onComplete(refined);
  };

  const handleClear = () => {
    form.setValue('premise', '');
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <Form {...form}>
        <form onSubmit={onSubmit}>
          {/* Section Header */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-semibold text-gray-900 dark:text-white">
              Story Premise
              <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-0.5 text-xs font-normal text-slate-400 backdrop-blur-sm transition-colors hover:bg-white/[0.08]"
                  >
                    <Sparkles className="h-3 w-3" />
                    {numberOfIdeas} variations
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
            </h2>

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-400 dark:text-gray-500">
                {premiseLength}/500
              </span>
              <Button
                type="submit"
                disabled={
                  isPending || llmStatus === 'pending' || premiseLength < 10
                }
                className="btn-cinema-primary gap-2 text-sm"
              >
                {isPending || llmStatus === 'pending' ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Ideas
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Collapsible Settings Panel */}
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleContent className="mb-6">
              <div className="cinema-panel space-y-6 p-6">
                {/* Duration and Content Style */}
                <DurationSelector
                  duration={targetDuration}
                  onDurationChange={setTargetDuration}
                  contentStyle={contentStyle}
                  onContentStyleChange={setContentStyle}
                  projectDefault={defaultDuration}
                  compact={false}
                />

                {/* Variations Slider */}
                <div className="flex items-center gap-8 border-t border-white/10 pt-4">
                  <FormField
                    control={form.control}
                    name="numberOfIdeas"
                    render={({ field }) => (
                      <FormItem className="max-w-xs flex-1">
                        <div className="mb-2 flex items-center justify-between">
                          <FormLabel className="text-xs font-normal text-gray-500 dark:text-gray-400">
                            Variations
                          </FormLabel>
                          <span className="text-sm font-medium text-gray-900 dark:text-white">
                            {field.value}
                          </span>
                        </div>
                        <FormControl>
                          <Slider
                            min={1}
                            max={5}
                            step={1}
                            value={[field.value ?? 3]}
                            onValueChange={([value]) => field.onChange(value)}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {(characterIds.length > 0 || locationIds.length > 0) && (
                    <div className="space-y-1">
                      <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                        Context
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {characterIds.length > 0 && (
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                            {characterIds.length} characters
                          </span>
                        )}
                        {locationIds.length > 0 && (
                          <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-white/10 dark:text-gray-300">
                            {locationIds.length} locations
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Draft Concept Card */}
          <div className="group relative mb-8">
            <div className="cinema-focus relative p-8 transition-all hover:border-indigo-500/30">
              {/* Label above card */}
              <div className="absolute -top-3 left-6 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-0.5 text-xs font-semibold tracking-wide text-indigo-400 uppercase backdrop-blur-sm">
                Draft Concept
              </div>

              {/* Description */}
              <label
                htmlFor="premise"
                className="mb-4 block text-sm font-medium text-gray-500 dark:text-gray-400"
              >
                Draft the core concept of your story. What happens? Who is
                involved?
              </label>

              {/* Textarea */}
              <FormField
                control={form.control}
                name="premise"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        id="premise"
                        placeholder="Once upon a time..."
                        className="cinema-story-text min-h-[200px] resize-none border-none bg-transparent p-0 shadow-none placeholder:text-slate-600 focus-visible:ring-0 sm:text-2xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Hover actions */}
              <div className="absolute right-4 bottom-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-full bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
                  title="Clear"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gray-100 p-2 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20"
                  title="Fullscreen"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Variation Cards (if generated) */}
          {ideas.length > 0 && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Generated Options
                </h3>
                <p className="text-xs text-slate-500">
                  Click a variation to refine and generate
                </p>
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {ideas.map((idea, index) => (
                  <IdeaCard
                    key={index}
                    idea={idea}
                    index={index}
                    onSelect={() => handleCardClick(idea)}
                  />
                ))}
              </div>
            </div>
          )}
        </form>
      </Form>

      {/* Refine Idea Modal */}
      {refineIdea && (
        <RefineIdeaModal
          key={refineIdea.title}
          idea={refineIdea}
          open={modalOpen}
          onOpenChange={setModalOpen}
          onConfirm={handleRefineComplete}
          isGenerating={isGenerating}
          targetDuration={targetDuration}
          contentStyle={contentStyle}
        />
      )}
    </div>
  );
}
