'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
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
import { Slider } from '@kit/ui/slider';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import {
  type GenerateStoryIdeasInput,
  GenerateStoryIdeasSchema,
} from '../../lib/schemas';
import { generateStoryIdeasAction } from '../../server/story-actions';
import { IdeaCard } from './idea-card';
import { TaggedAssetsDisplay } from './tagged-assets-display';

interface StoryIdeationProps {
  episodeId: string; // Required for context building
  onComplete: (selectedIdea: StoryIdea) => void;
  isGenerating?: boolean;
  projectGenre?: string;
  projectStyle?: string;
  projectAudience?: string;
  initialPremise?: string;
  characterIds?: string[];
  locationIds?: string[];
}

export function StoryIdeation({
  episodeId,
  onComplete,
  isGenerating = false,
  projectGenre = 'general',
  projectStyle = 'balanced',
  projectAudience = 'general',
  initialPremise,
  characterIds = [],
  locationIds = [],
}: StoryIdeationProps) {
  const [isPending, startTransition] = useTransition();
  const [ideas, setIdeas] = useState<StoryIdea[]>([]);
  const [selectedIdea, setSelectedIdea] = useState<StoryIdea | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);

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
        // Context builder handles characters, locations, season, etc.
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
      onComplete(selectedIdea);
    }
  };

  const handleRegenerate = () => {
    setIdeas([]);
    setSelectedIdea(null);
    setHasGenerated(false);
  };

  return (
    <div className="space-y-6">
      {/* Premise Input Form */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            <CardTitle>Story Ideation</CardTitle>
          </div>
          <CardDescription>
            Enter your story premise. Generation settings are inherited from your project.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Show tagged characters/locations if available */}
          {(characterIds.length > 0 || locationIds.length > 0) && (
            <TaggedAssetsDisplay
              characterIds={characterIds}
              locationIds={locationIds}
            />
          )}

          <Form {...form}>
            <form onSubmit={onSubmit} className="space-y-6">
              <FormField
                control={form.control}
                name="premise"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Premise</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Enter your story premise in 1-2 sentences..."
                        className="min-h-[100px] resize-none"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex justify-between text-xs">
                      <FormDescription>
                        Describe the core concept of your story
                      </FormDescription>
                      <span
                        className={
                          premiseLength < 10
                            ? 'text-destructive'
                            : premiseLength > 450
                              ? 'text-yellow-500'
                              : 'text-muted-foreground'
                        }
                      >
                        {premiseLength}/500
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="numberOfIdeas"
                render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>Number of Ideas</FormLabel>
                      <span className="text-muted-foreground text-sm">
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
                    <FormDescription>
                      Generate between 1-5 story ideas to choose from
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex justify-end gap-2">
                {hasGenerated && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleRegenerate}
                    disabled={isPending}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    New Premise
                  </Button>
                )}
                <Button type="submit" disabled={isPending}>
                  {isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      {hasGenerated ? 'Regenerate Ideas' : 'Generate Ideas'}
                    </>
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* Generated Ideas */}
      {ideas.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Generated Story Ideas</h3>
            {selectedIdea && (
              <Button onClick={handleContinue} disabled={isGenerating}>
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

          {!selectedIdea && (
            <p className="text-muted-foreground text-center text-sm">
              Select a story idea to continue to the next step
            </p>
          )}
        </div>
      )}
    </div>
  );
}
