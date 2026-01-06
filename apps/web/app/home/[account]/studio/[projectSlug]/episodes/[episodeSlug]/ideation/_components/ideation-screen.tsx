'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  ChevronDown,
  Loader2,
  Maximize2,
  RotateCcw,
  Sparkles,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { StoryIdeaWithSettings } from '@kit/episodes/components';
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
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import { useEpisodeContext } from '../../_components/episode-context-provider';
import { IdeaCard } from './idea-card';

interface IdeationScreenProps {
  episodeId: string;
  onComplete: (selection: StoryIdeaWithSettings) => void;
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
  const [isPending, startTransition] = useTransition();
  const [ideas, setIdeas] = useState<StoryIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<StoryIdea | null>(null);
  const [_hasGenerated, setHasGenerated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Duration and content style state
  const [targetDuration, setTargetDuration] = useState(defaultDuration);
  const [contentStyle, setContentStyle] =
    useState<ContentStyle>(defaultContentStyle);

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
    startTransition(async () => {
      try {
        const result = await generateStoryIdeasAction(data);

        if (result.success) {
          setIdeas(result.data.ideas);
          setSelectedIdea(null);
          setHasGenerated(true);
          toast.success(`Generated ${result.data.ideas.length} story ideas`);
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to generate story ideas',
        );
      }
    });
  });

  const handleContinue = () => {
    if (selectedIdea) {
      setIsGenerating(true);
      onComplete({
        ...selectedIdea,
        targetDuration,
        contentStyle,
      });
    }
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
                    className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-normal text-gray-500 transition-colors hover:bg-gray-200 dark:bg-white/10 dark:text-gray-400 dark:hover:bg-white/20"
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
                disabled={isPending || premiseLength < 10}
                className="gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 transition-all hover:bg-blue-700 active:scale-95"
              >
                {isPending ? (
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
              <div className="space-y-6 rounded-xl border border-gray-200 bg-card p-6">
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
                <div className="flex items-center gap-8 border-t border-gray-200 pt-4 dark:border-gray-700">
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
            <div className="relative rounded-2xl border border-gray-200 bg-card p-8 shadow-sm transition-all hover:border-primary/50 hover:shadow-lg dark:hover:border-blue-800">
              {/* Label above card */}
              <div className="absolute -top-3 left-6 bg-gray-50 px-2 text-xs font-semibold tracking-wide text-blue-600 uppercase dark:bg-gray-900 dark:text-blue-400">
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
                        className="min-h-[200px] resize-none border-none bg-transparent p-0 font-serif text-xl leading-relaxed text-gray-900 shadow-none placeholder:text-gray-300 focus-visible:ring-0 sm:text-2xl dark:text-white dark:placeholder:text-gray-600"
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
                {selectedIdea && (
                  <Button
                    onClick={handleContinue}
                    disabled={isGenerating}
                    className="gap-2 bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating Story...
                      </>
                    ) : (
                      <>
                        Continue with Selected
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {ideas.map((idea, index) => (
                  <IdeaCard
                    key={index}
                    idea={idea}
                    index={index}
                    isSelected={selectedIdea?.title === idea.title}
                    onSelect={() => setSelectedIdea(idea)}
                  />
                ))}
              </div>
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
