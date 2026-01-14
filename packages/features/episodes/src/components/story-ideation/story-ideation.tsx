'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  Settings2,
  Sparkles,
} from 'lucide-react';
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
          if (result.queued) {
            toast.info('Generating ideas in the background...');
          } else if (result.data) {
            setIdeas(result.data.ideas);
            setSelectedIdea(null);
            setHasGenerated(true);
            toast.success(`Generated ${result.data.ideas.length} story ideas`);
          }
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

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={onSubmit}>
          {/* Sticky Header with Generate Button */}
          <div className="glass border-glass-border sticky top-0 z-10 -mx-4 mb-6 border-b px-4 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-semibold">Story Premise</h2>

                {/* Settings Toggle */}
                <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5">
                      <Settings2 className="h-4 w-4" />
                      <span className="text-muted-foreground text-xs">
                        {numberOfIdeas} variations
                      </span>
                      {settingsOpen ? (
                        <ChevronUp className="h-3 w-3" />
                      ) : (
                        <ChevronDown className="h-3 w-3" />
                      )}
                    </Button>
                  </CollapsibleTrigger>
                </Collapsible>
              </div>

              <div className="flex items-center gap-2">
                {hasGenerated && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleRegenerate}
                    disabled={isPending}
                  >
                    Clear
                  </Button>
                )}

                <Button
                  type="submit"
                  variant="generate"
                  disabled={isPending || premiseLength < 10}
                  className="gap-2"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {hasGenerated ? 'Regenerate' : 'Generate Ideas'}
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Collapsible Settings Panel */}
            <Collapsible open={settingsOpen} onOpenChange={setSettingsOpen}>
              <CollapsibleContent className="pt-4">
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
          </div>

          {/* Main Content Area - Full Width */}
          <div className="space-y-8">
            {/* Premise Editor */}
            <div>
              <p className="text-muted-foreground mb-4">
                Draft the core concept of your story. What happens? Who is
                involved?
              </p>

              <FormField
                control={form.control}
                name="premise"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Once upon a time..."
                        className="reading-mode min-h-[200px] resize-none border-none bg-transparent p-0 text-xl leading-relaxed shadow-none focus-visible:ring-0 sm:text-2xl"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex justify-end pt-2">
                      <span
                        className={cn(
                          'mono-data text-xs font-medium',
                          premiseLength < 10
                            ? 'text-destructive'
                            : premiseLength > 450
                              ? 'text-status-draft'
                              : 'text-muted-foreground/50',
                        )}
                      >
                        {premiseLength}/500
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {/* Generated Ideas Section */}
            {ideas.length > 0 && (
              <div className="space-y-6 border-t pt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">Generated Options</h3>
                  {selectedIdea && (
                    <Button
                      onClick={handleContinue}
                      disabled={isGenerating}
                      variant="generate"
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

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {ideas.map((idea, index) => (
                    <IdeaCard
                      key={index}
                      idea={idea}
                      isSelected={selectedIdea?.title === idea.title}
                      onSelect={() => setSelectedIdea(idea)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </form>
      </Form>
    </div>
  );
}
