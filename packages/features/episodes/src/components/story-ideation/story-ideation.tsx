'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Loader2, Maximize2, RotateCcw } from 'lucide-react';
import { useForm } from 'react-hook-form';

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
import { cn } from '@kit/ui/utils';

import type { ContentStyle } from '../../lib/duration-scaling';
import {
  type GenerateStoryIdeasInput,
  GenerateStoryIdeasSchema,
} from '../../lib/schemas';
import { generateStoryIdeasAction } from '../../server/story-actions';
import { DurationSelector } from '../duration-selector';
import { MaterialIcon } from '../ui/material-icon';
import { IdeaCard } from './idea-card';
import { TaggedAssetsDisplay } from './tagged-assets-display';

/** Extended story idea with generation settings */
export interface StoryIdeaWithSettings extends StoryIdea {
  targetDuration: number;
  contentStyle: ContentStyle;
}

interface StoryIdeationProps {
  episodeId: string;
  onComplete: (selection: StoryIdeaWithSettings) => void;
  isGenerating?: boolean;
  projectGenre?: string;
  projectStyle?: string;
  projectAudience?: string;
  initialPremise?: string;
  characterIds?: string[];
  locationIds?: string[];
  /** Project's default episode duration in seconds */
  defaultDuration?: number;
  /** Project's default content style */
  defaultContentStyle?: ContentStyle;
}

/**
 * StoryIdeation - Redesigned with sticky header and collapsible settings
 */
export function StoryIdeation({
  episodeId,
  onComplete,
  isGenerating = false,
  initialPremise,
  characterIds = [],
  locationIds = [],
  defaultDuration = 300,
  defaultContentStyle = 'dialogue-heavy',
}: StoryIdeationProps) {
  const [isPending, startTransition] = useTransition();
  const [ideas, setIdeas] = useState<StoryIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<StoryIdea | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Duration and content style state
  const [targetDuration, setTargetDuration] = useState(defaultDuration);
  const [contentStyle, setContentStyle] =
    useState<ContentStyle>(defaultContentStyle);

  const form = useForm({
    resolver: zodResolver(GenerateStoryIdeasSchema),
    defaultValues: {
      episodeId,
      premise: initialPremise || '',
      numberOfIdeas: 3,
    },
  });

  const premiseValue = form.watch('premise');
  const premiseLength = premiseValue?.length ?? 0;

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
      onComplete({
        ...selectedIdea,
        targetDuration,
        contentStyle,
      });
    }
  };

  const handleRegenerate = () => {
    setIdeas([]);
    setSelectedIdea(null);
    setHasGenerated(false);
  };

  const numberOfIdeas = form.watch('numberOfIdeas');
  const [isFullscreen, setIsFullscreen] = useState(false);

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={onSubmit}>
          {/* Header with Generate Button */}
          <div className="mb-6 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              Story Premise
              <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:bg-muted flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-normal transition-colors dark:bg-white/10 dark:hover:bg-white/20"
                  >
                    <MaterialIcon name="shuffle" className="text-xs" />
                    {numberOfIdeas} variations
                    <MaterialIcon name="expand_more" className="text-xs" />
                  </button>
                </CollapsibleTrigger>
              </Collapsible>
            </h2>

            <div className="flex items-center gap-3">
              <div className="text-muted-foreground mono-data text-xs font-medium">
                {premiseLength}/500
              </div>
              <Button
                type="submit"
                disabled={isPending || premiseLength < 10}
                className="bg-primary shadow-glow-primary hover:bg-primary/90 gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-all active:scale-95"
              >
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="auto_awesome" className="text-lg" />
                    Generate Ideas
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Collapsible Settings Panel */}
          <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
            <CollapsibleContent className="mb-6">
              <div className="space-y-6">
                {/* Duration and Content Style */}
                <DurationSelector
                  duration={targetDuration}
                  onDurationChange={setTargetDuration}
                  contentStyle={contentStyle}
                  onContentStyleChange={setContentStyle}
                  projectDefault={defaultDuration}
                  compact={false}
                />

                {/* Variations and Context */}
                <div className="flex items-center gap-8 border-t pt-4">
                  <FormField
                    control={form.control}
                    name="numberOfIdeas"
                    render={({ field }) => (
                      <FormItem className="max-w-xs flex-1">
                        <div className="mb-2 flex items-center justify-between">
                          <FormLabel className="text-muted-foreground text-xs font-normal">
                            Variations
                          </FormLabel>
                          <span className="text-sm font-medium">
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
                      <span className="text-muted-foreground text-xs font-normal">
                        Context
                      </span>
                      <TaggedAssetsDisplay
                        characterIds={characterIds}
                        locationIds={locationIds}
                      />
                    </div>
                  )}
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Draft Concept Card */}
          <div className="group relative mb-8">
            <div className="border-border shadow-apple hover:shadow-apple-lg hover:border-primary/20 liquid-card-light relative rounded-2xl border p-8 transition-all">
              {/* Label above card */}
              <div className="bg-background text-primary absolute -top-3 left-6 px-2 text-xs font-semibold uppercase tracking-wide">
                Draft Concept
              </div>

              {/* Description */}
              <label
                htmlFor="premise"
                className="text-muted-foreground mb-4 block text-sm font-medium"
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
                        className="min-h-[200px] resize-none border-none bg-transparent p-0 font-serif text-xl leading-relaxed shadow-none focus-visible:ring-0 sm:text-2xl"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Hover actions */}
              <div className="absolute bottom-4 right-4 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  type="button"
                  onClick={() => form.setValue('premise', '')}
                  className="hover:bg-muted/80 bg-muted rounded-full p-2 text-gray-600 transition-colors dark:bg-white/10 dark:hover:bg-white/20"
                  title="Clear"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFullscreen(!isFullscreen)}
                  className="hover:bg-muted/80 bg-muted rounded-full p-2 text-gray-600 transition-colors dark:bg-white/10 dark:hover:bg-white/20"
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
                <h3 className="text-lg font-semibold">Generated Options</h3>
                {selectedIdea && (
                  <Button
                    onClick={handleContinue}
                    disabled={isGenerating}
                    className="bg-primary shadow-glow-primary hover:bg-primary/90 gap-2 text-white"
                  >
                    {isGenerating ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Generating Story...
                      </>
                    ) : (
                      <>
                        Continue with Selected
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                {ideas.map((idea, index) => (
                  <div
                    key={index}
                    className={cn(
                      'group relative cursor-pointer rounded-xl border p-6 transition-colors',
                      selectedIdea?.title === idea.title
                        ? 'border-primary bg-primary/5'
                        : 'border-border bg-white/50 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10',
                    )}
                    onClick={() => setSelectedIdea(idea)}
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <h4 className="text-muted-foreground text-sm font-semibold uppercase tracking-wide">
                        Variation {index + 1}
                      </h4>
                      <MaterialIcon
                        name="arrow_forward"
                        className={cn(
                          'text-muted-foreground transition-opacity',
                          selectedIdea?.title === idea.title
                            ? 'opacity-100'
                            : 'opacity-0 group-hover:opacity-100',
                        )}
                      />
                    </div>
                    <p className="line-clamp-3 text-sm leading-relaxed">
                      {idea.logline}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </Form>
    </div>
  );
}
