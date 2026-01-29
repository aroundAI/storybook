'use client';

import { useEffect, useState, useTransition } from 'react';

import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Loader2,
  Maximize2,
  Minimize2,
  Users,
} from 'lucide-react';

import { convertToScreenplayAction } from '@kit/episodes/server';
import { useEpisodeContext } from '../../_components/episode-context-provider';
import type { EpisodeWithShots, StoryCharacterArc } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { ActDivider } from './act-divider';
import { CanonDashboard } from './canon-dashboard';
import { InlineViolationWarning } from './inline-violation-warning';

interface StoryScreenProps {
  episode: EpisodeWithShots;
  onScreenplayComplete: () => void;
  refetchEpisode: () => void;
}

const ROLE_COLORS: Record<string, string> = {
  protagonist:
    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  antagonist: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  supporting:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
};

export function StoryScreen({
  episode,
  onScreenplayComplete,
  refetchEpisode,
}: StoryScreenProps) {
  const { setIsGenerating } = useEpisodeContext(); // Add context hook
  const [isPending, _startTransition] = useTransition();
  const [isReadingMode, setIsReadingMode] = useState(false);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'info' | 'canon'>('info');
  const storyData = episode.storyData;

  // WebSocket for screenplay-conversion async LLM results
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
    trigger: triggerLlm,
  } = useLlmJob<{ screenplay: { scenes: unknown[] } }>('screenplay-conversion');

  // WebSocket for story-generation results (when story is generated while on this tab)
  const {
    status: storyGenStatus,
    result: storyGenResult,
    error: storyGenError,
  } = useLlmJob<{ success: boolean }>('story-generation');

  // Handle async screenplay-conversion result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // llmResult is already the result object from message.result (contains {success, data})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = (llmResult as any)?.data;
      if (resultData?.screenplay?.scenes?.length) {
        toast.success(
          `Screenplay generated with ${resultData.screenplay.scenes.length} scenes`,
        );
        refetchEpisode();
        onScreenplayComplete();
      }
    } else if (llmStatus === 'error') {
      setIsGenerating(false); // Reset on error
      toast.error(llmError || 'Failed to convert to screenplay');
    }
  }, [llmStatus, llmResult, llmError, refetchEpisode, onScreenplayComplete, setIsGenerating]);

  // Handle story-generation result (refresh to show generated story)
  useEffect(() => {
    if (storyGenStatus === 'success' && storyGenResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = storyGenResult as any;
      if (resultData?.success) {
        toast.success('Story generated successfully');
        refetchEpisode();
      }
    } else if (storyGenStatus === 'error') {
      toast.error(storyGenError || 'Failed to generate story');
    }
  }, [storyGenStatus, storyGenResult, storyGenError, refetchEpisode]);

  const handleConvertToScreenplay = () => {
    setIsGenerating(true); // Set generating state at start
    triggerLlm(async () => {
      const result = await convertToScreenplayAction({
        episodeId: episode.id,
      });
      // If local dev (synchronous), process immediately
      if (result.success && result.data) {
        toast.success(
          `Screenplay generated with ${result.data.screenplay.scenes.length} scenes`,
        );
        refetchEpisode();
        onScreenplayComplete();
        return { success: true, data: result.data };
      }
      // If queued, return queued flag (WebSocket will deliver result)
      if (result?.queued) {
        toast.info('Converting to screenplay in background...');
        return { success: true, queued: true };
      }
      setIsGenerating(false); // Reset on synchronous error
      throw new Error('Failed to convert to screenplay');
    });
  };

  if (!storyData?.fullStory) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="cinema-panel p-12 text-center">
          <h2 className="mb-2 text-xl font-semibold text-white">
            No Story Generated
          </h2>
          <p className="text-slate-400">
            Select an idea from the Ideation tab to generate a full story.
          </p>
        </div>
      </div>
    );
  }

  // Parse story into sections with act dividers
  const formatStoryContent = (text: string) => {
    const elements: React.ReactNode[] = [];
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      // ACT headers (e.g. ACT ONE, ACT 1, ACT I)
      const actMatch = line
        .trim()
        .match(
          /^ACT\s+(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|I|II|III|IV|V|VI|\d+)/i,
        );
      if (actMatch?.[1]) {
        elements.push(
          <ActDivider key={`act-${index}`} actNumber={actMatch[1]} />,
        );
        return;
      }

      // Scene headers (e.g. INT. HOUSE - DAY)
      if (/^(INT\.|EXT\.)/i.test(line.trim())) {
        elements.push(
          <p
            key={index}
            className="mt-8 mb-4 font-mono text-sm font-bold tracking-wider text-gray-500 uppercase dark:text-gray-400"
          >
            {line}
          </p>,
        );
        return;
      }

      // Regular paragraphs
      if (line.trim()) {
        elements.push(
          <p key={index} className="cinema-story-text mb-4">
            {line}
          </p>,
        );
      }
    });

    return elements;
  };

  const hasScreenplay = Boolean(episode.screenplayData?.scenes?.length);

  // Reading mode - full screen
  if (isReadingMode) {
    return (
      <div className="fixed inset-0 z-50 overflow-y-auto bg-gray-50 p-8 dark:bg-gray-900">
        <div className="relative mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
          {/* Label */}
          <div className="absolute -top-3 left-6 bg-gray-50 px-2 text-xs font-semibold tracking-wide text-blue-600 uppercase dark:bg-gray-900 dark:text-blue-400">
            Story
          </div>

          {/* Header */}
          <div className="flex items-start justify-between border-b border-gray-100 p-6 dark:border-gray-700">
            <div className="flex-1 text-center">
              <h2 className="font-serif text-3xl font-bold text-gray-900 dark:text-white">
                {storyData.title ?? 'Untitled Story'}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsReadingMode(false)}
              title="Exit Reading Mode"
              className="absolute top-6 right-6 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <Minimize2 className="h-5 w-5" />
            </Button>
          </div>

          {/* Story Content */}
          <div className="p-8 pb-24">
            <div className="prose prose-gray dark:prose-invert mx-auto max-w-2xl">
              {formatStoryContent(storyData.fullStory)}
            </div>
          </div>

          {/* Themes at bottom */}
          {storyData.themes && storyData.themes.length > 0 && (
            <div className="border-t border-gray-100 p-6 dark:border-gray-700">
              <div className="mx-auto flex max-w-2xl flex-wrap gap-2">
                {storyData.themes.map((theme, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                  >
                    {theme}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Normal mode
  return (
    <div className="relative min-h-full p-8">
      <div className="mx-auto max-w-5xl">
        {/* Canon Violation Warnings */}
        {storyData?.fullStory && (
          <InlineViolationWarning
            projectId={episode.projectId}
            episodeId={episode.id}
            storyContent={storyData.fullStory}
          />
        )}

        {/* Story Card */}
        <div className="cinema-focus relative">
          {/* Label */}
          <div className="absolute -top-3 left-6 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-0.5 text-xs font-semibold tracking-wide text-indigo-400 uppercase backdrop-blur-sm">
            Story
          </div>

          {/* Header */}
          <div className="flex items-start justify-between border-b border-white/10 p-6">
            <div className="flex-1">
              <h2 className="font-serif text-2xl font-bold text-gray-900 dark:text-white">
                {storyData.title ?? 'Untitled Story'}
              </h2>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Generated story for this episode
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsReadingMode(true)}
                title="Enter Reading Mode"
                className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              >
                <Maximize2 className="h-5 w-5" />
              </Button>

              {!hasScreenplay && (
                <Button
                  onClick={handleConvertToScreenplay}
                  disabled={isPending || llmStatus === 'pending'}
                  className="btn-cinema-primary gap-2"
                >
                  {isPending || llmStatus === 'pending' ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Converting...
                    </>
                  ) : (
                    <>
                      Convert to Screenplay
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
              )}

              {hasScreenplay && (
                <Button
                  onClick={onScreenplayComplete}
                  className="btn-cinema-primary gap-2 bg-gradient-to-r from-emerald-500 to-green-600"
                >
                  View Screenplay
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>

          {/* Story Content */}
          <div className="p-8">
            <div className="prose prose-gray dark:prose-invert max-w-none">
              {formatStoryContent(storyData.fullStory)}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Glass Sidebar */}
      <>
        {/* Trigger Button - Fixed to right edge */}
        <button
          onClick={() => setIsSidebarExpanded(!isSidebarExpanded)}
          className={cn(
            'bg-card/70 hover:bg-card/90 fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-white/30 p-3 shadow-lg backdrop-blur-xl transition-all dark:hover:bg-gray-800/90',
            isSidebarExpanded && 'right-80',
          )}
        >
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-gray-500 dark:text-gray-400" />
            <ChevronRight
              className={cn(
                'h-4 w-4 text-gray-400 transition-transform',
                isSidebarExpanded && 'rotate-180',
              )}
            />
          </div>
        </button>

        {/* Sidebar Panel */}
        <div
          className={cn(
            'bg-card/60 fixed top-0 right-0 z-30 h-full w-80 transform border-l border-white/20 shadow-2xl backdrop-blur-xl transition-transform duration-300',
            isSidebarExpanded ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          <div className="flex h-full flex-col">
            {/* Tabbed Header */}
            <div className="border-b border-white/20 dark:border-gray-700/30">
              <div className="flex">
                <button
                  onClick={() => setSidebarTab('info')}
                  className={cn(
                    'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                    sidebarTab === 'info'
                      ? 'border-b-2 border-indigo-500 text-indigo-600 dark:text-indigo-400'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4" />
                    Story Info
                  </div>
                </button>
                <button
                  onClick={() => setSidebarTab('canon')}
                  className={cn(
                    'flex-1 px-4 py-3 text-sm font-medium transition-colors',
                    sidebarTab === 'canon'
                      ? 'border-b-2 border-violet-500 text-violet-600 dark:text-violet-400'
                      : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <BookOpen className="h-4 w-4" />
                    Canon
                  </div>
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {sidebarTab === 'info' ? (
                <div className="space-y-4">
                  {/* Story Details */}
                  <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                    <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                      Story Details
                    </h3>
                    <div className="space-y-2 text-xs">
                      {storyData.tone && (
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">
                            Tone
                          </span>
                          <span className="text-right font-medium text-gray-900 dark:text-white">
                            {storyData.tone}
                          </span>
                        </div>
                      )}
                      {storyData.estimatedSceneCount && (
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">
                            Est. Scenes
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {storyData.estimatedSceneCount}
                          </span>
                        </div>
                      )}
                      {storyData.targetDuration && (
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">
                            Target Duration
                          </span>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {Math.floor(storyData.targetDuration / 60)}m
                          </span>
                        </div>
                      )}
                      {storyData.contentStyle && (
                        <div className="flex justify-between">
                          <span className="text-gray-500 dark:text-gray-400">
                            Style
                          </span>
                          <span className="font-medium text-gray-900 capitalize dark:text-white">
                            {storyData.contentStyle.replace('-', ' ')}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Act Breakdown */}
                  {storyData.actBreakdown && (
                    <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                        Act Breakdown
                      </h3>
                      <div className="space-y-3">
                        <div>
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            Act 1
                          </span>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                            {storyData.actBreakdown.act1}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            Act 2
                          </span>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                            {storyData.actBreakdown.act2}
                          </p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
                            Act 3
                          </span>
                          <p className="mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                            {storyData.actBreakdown.act3}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Themes */}
                  {storyData.themes && storyData.themes.length > 0 && (
                    <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                      <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                        Themes
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {storyData.themes.map((theme, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
                          >
                            {theme}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Characters */}
                  {storyData.characters && storyData.characters.length > 0 && (
                    <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                        <Users className="h-4 w-4" />
                        Characters
                      </h3>
                      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                        {storyData.characters.length} character
                        {storyData.characters.length !== 1 ? 's' : ''} in this
                        story
                      </p>
                      <div className="space-y-3">
                        {storyData.characters.map(
                          (character: StoryCharacterArc, index: number) => (
                            <div
                              key={index}
                              className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 dark:border-gray-700 dark:bg-gray-800/50"
                            >
                              <div className="mb-2 flex items-start justify-between">
                                <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                                  {character.name}
                                </h4>
                                <span
                                  className={cn(
                                    'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
                                    ROLE_COLORS[character.role.toLowerCase()] ??
                                    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
                                  )}
                                >
                                  {character.role}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-300">
                                {character.arc}
                              </p>
                            </div>
                          ),
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <CanonDashboard
                  projectId={episode.projectId ?? ''}
                  episodeId={episode.id}
                  episodeNumber={episode.number ?? 1}
                  season={typeof episode.season === 'object' ? episode.season?.number ?? 1 : 1}
                  canonEnabled={false}
                />
              )}
            </div>
          </div>
        </div>

        {/* Backdrop */}
        {isSidebarExpanded && (
          <div
            className="fixed inset-0 z-20 bg-black/20"
            onClick={() => setIsSidebarExpanded(false)}
          />
        )}
      </>
    </div>
  );
}
