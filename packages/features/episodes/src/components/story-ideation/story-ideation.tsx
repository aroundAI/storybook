'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowRight,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { useForm } from 'react-hook-form';

import { cn } from '@kit/ui/utils';

import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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
  // projectGenre = 'general',
  // projectStyle = 'balanced',
  // projectAudience = 'general',
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
    <div className="space-y-8">
      <Form {...form}>
        <form onSubmit={onSubmit}>
          <div className="flex flex-col gap-8 lg:flex-row">
            {/* Main Content - Premise Editor */}
            <div className="flex-1 space-y-6">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Story Premise</h2>
                <p className="text-muted-foreground mt-1">
                  Draft the core concept of your story. What happens? Who is involved?
                </p>
              </div>

              <FormField
                control={form.control}
                name="premise"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        placeholder="Once upon a time..."
                        className="min-h-[200px] resize-none border-none bg-transparent p-0 text-xl leading-relaxed shadow-none focus-visible:ring-0 sm:text-2xl"
                        {...field}
                      />
                    </FormControl>
                    <div className="flex justify-end pt-2">
                      <span
                        className={cn(
                          "text-xs font-medium",
                          premiseLength < 10
                            ? 'text-destructive'
                            : premiseLength > 450
                              ? 'text-yellow-500'
                              : 'text-muted-foreground/50'
                        )}
                      >
                        {premiseLength}/500
                      </span>
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Generated Ideas Section (Inline) */}
              {ideas.length > 0 && (
                <div className="mt-12 space-y-6 border-t pt-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold">Generated Options</h3>
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

                  <div className="grid gap-4 sm:grid-cols-2">
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

            {/* Side Panel - Controls */}
            <div className="w-full space-y-6 lg:w-80">
              <Card className="bg-muted/30 border-none shadow-none">
                <CardHeader>
                  <CardTitle className="text-base">Generation Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="numberOfIdeas"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between mb-2">
                          <FormLabel className="text-xs font-normal text-muted-foreground">Variations</FormLabel>
                          <span className="text-sm font-medium">{field.value}</span>
                        </div>
                        <FormControl>
                          <Slider
                            min={1}
                            max={5}
                            step={1}
                            value={[field.value ?? 3]}
                            onValueChange={([value]) => field.onChange(value)}
                            className="[&_.span]:h-4 [&_.span]:w-4"
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {(characterIds.length > 0 || locationIds.length > 0) && (
                    <div className="space-y-2">
                      <span className="text-xs font-normal text-muted-foreground">Context</span>
                      <TaggedAssetsDisplay
                        characterIds={characterIds}
                        locationIds={locationIds}
                      />
                    </div>
                  )}

                  <div className="pt-4">
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isPending || premiseLength < 10}
                    >
                      {isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="mr-2 h-4 w-4" />
                          {hasGenerated ? 'Regenerate' : 'Generate Ideas'}
                        </>
                      )}
                    </Button>

                    {hasGenerated && (
                      <Button
                        type="button"
                        variant="ghost"
                        className="mt-2 w-full text-muted-foreground"
                        onClick={handleRegenerate}
                        disabled={isPending}
                      >
                        Clear & Start Over
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </form>
      </Form>
    </div>
  );
}
