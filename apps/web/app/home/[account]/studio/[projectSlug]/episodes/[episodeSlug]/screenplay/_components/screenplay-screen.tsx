'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import {
  ArrowRight,
  Check,
  ChevronRight,
  Loader2,
  MapPin,
  Users,
} from 'lucide-react';

import { generateShotListAction } from '@kit/episodes/server';
import type {
  EpisodeWithShots,
  ScreenplayData,
  ScreenplayScene,
} from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { useEpisodeContext } from '../../_components/episode-context-provider';
import { SceneIndexSidebar } from './scene-index-sidebar';
import { ScreenplayPaper } from './screenplay-paper';

interface ScreenplayScreenProps {
  episode: EpisodeWithShots;
  onShotListComplete: () => void;
  refetchEpisode: () => void;
}

function parseScenes(screenplayData: ScreenplayData | null): ScreenplayScene[] {
  if (!screenplayData?.scenes?.length) {
    return [];
  }
  return screenplayData.scenes;
}

export function ScreenplayScreen({
  episode,
  onShotListComplete,
  refetchEpisode,
}: ScreenplayScreenProps) {
  const { setIsGenerating } = useEpisodeContext();
  const [isPending, _startTransition] = useTransition();
  const [activeSceneNumber, setActiveSceneNumber] = useState(1);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const scenes = parseScenes(episode.screenplayData);
  const metadata = episode.screenplayData?.metadata;
  const hasShotList = Boolean(episode.shotList) || episode.shots.length > 0;

  // WebSocket for shot-generation async LLM results
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
    trigger: triggerLlm,
  } = useLlmJob<{ shotsCreated: number }>('shot-generation');

  // WebSocket for screenplay-conversion results (when screenplay is generated while on this tab)
  const {
    status: screenplayStatus,
    result: screenplayResult,
    error: screenplayError,
  } = useLlmJob<{ success: boolean }>('screenplay-conversion');

  // Handle shot-generation async result
  // NOTE: Navigation is handled immediately on queue (see handleGenerateShotList).
  // The visual-studio page has its own WebSocket handler + GeneratingState to detect completion.
  // This handler only needs to refetch if the user is still on this page when it completes.
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = llmResult as any;
      if (resultData?.success) {
        toast.success('Shot list generated successfully');
        refetchEpisode();
      }
    } else if (llmStatus === 'error') {
      setIsGenerating(false); // Reset on error
      toast.error(llmError || 'Failed to generate shot list');
    }
  }, [llmStatus, llmResult, llmError, refetchEpisode, setIsGenerating]);

  // Handle screenplay-conversion result (refresh to show generated screenplay)
  useEffect(() => {
    if (screenplayStatus === 'success' && screenplayResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = screenplayResult as any;
      if (resultData?.success) {
        toast.success('Screenplay converted successfully');
        refetchEpisode();
      }
    } else if (screenplayStatus === 'error') {
      toast.error(screenplayError || 'Failed to convert screenplay');
    }
  }, [screenplayStatus, screenplayResult, screenplayError, refetchEpisode]);

  const scrollToScene = useCallback((sceneNumber: number) => {
    setActiveSceneNumber(sceneNumber);
    const element = document.getElementById(`scene-${sceneNumber}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Track active scene on scroll
  useEffect(() => {
    if (!scenes.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const sceneNumber = parseInt(
              entry.target.id.replace('scene-', ''),
              10,
            );
            if (!isNaN(sceneNumber)) {
              setActiveSceneNumber(sceneNumber);
            }
          }
        });
      },
      { threshold: 0.3, rootMargin: '-100px 0px -50% 0px' },
    );

    scenes.forEach((scene) => {
      const element = document.getElementById(`scene-${scene.number}`);
      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [scenes]);

  const handleGenerateShotList = () => {
    setIsGenerating(true); // Set generating state at start
    triggerLlm(async () => {
      const result = await generateShotListAction({
        episodeId: episode.id,
        shotDurationMin: 5,
        shotDurationMax: 8,
        videoProvider: 'kling',
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((result as any)?.queued) {
        toast.info(
          'Generating shot list in background... This may take a few minutes.',
        );
        // Navigate immediately — the visual-studio page has its own
        // GeneratingState + WebSocket handler to detect completion and auto-refresh
        onShotListComplete();
        return { queued: true };
      }
      // If local dev (synchronous), process immediately
      if (result.success) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const resultData = result as any;
        const shotsCreated =
          resultData?.data?.shotsCreated ?? resultData?.shotsCreated ?? 0;
        toast.success(`Shot list generated with ${shotsCreated} shots`);
        refetchEpisode();
        onShotListComplete();
        return { success: true, data: { shotsCreated } };
      }
      setIsGenerating(false); // Reset on synchronous error
      throw new Error('Failed to generate shot list');
    });
  };

  if (!scenes.length) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="cinema-panel p-12 text-center">
          <h2 className="mb-2 text-xl font-semibold text-white">
            No Screenplay
          </h2>
          <p className="text-slate-400">
            Convert your story to screenplay format first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header Bar */}
      <div className="cinema-workspace flex items-center justify-between border-b border-white/5 px-6 py-3">
        <div className="flex items-center gap-4">
          <h2 className="font-semibold text-gray-900 dark:text-white">
            Screenplay
          </h2>
          {metadata && (
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>{metadata.totalScenes} scenes</span>
              <span>•</span>
              <span>~{Math.round(metadata.estimatedDuration / 60)} min</span>
              <span>•</span>
              <span>{metadata.characters?.length ?? 0} characters</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {hasShotList ? (
            <Button
              onClick={onShotListComplete}
              className="btn-cinema-primary gap-2 bg-gradient-to-r from-emerald-500 to-green-600"
            >
              View Shot List
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleGenerateShotList}
              disabled={isPending || llmStatus === 'pending'}
              className="btn-cinema-primary gap-2"
            >
              {isPending || llmStatus === 'pending' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Generating Shot List...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4" />
                  Approve & Generate Shots
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Main Content - Two Column Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Scene Index */}
        <div className="w-56 shrink-0 border-r border-white/5 bg-white/[0.02]">
          <SceneIndexSidebar
            scenes={scenes}
            activeSceneNumber={activeSceneNumber}
            onSceneSelect={scrollToScene}
          />
        </div>

        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto bg-slate-950 p-8"
        >
          <ScreenplayPaper
            scenes={scenes}
            activeSceneNumber={activeSceneNumber}
          />
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
            {/* Header */}
            <div className="border-b border-white/20 p-6 dark:border-gray-700/30">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Screenplay Info
              </h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                Characters & locations
              </p>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {/* Screenplay Details */}
                {metadata && (
                  <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                    <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
                      Screenplay Details
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">
                          Scenes
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          {metadata.totalScenes}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">
                          Est. Duration
                        </span>
                        <span className="font-medium text-gray-900 dark:text-white">
                          ~{Math.round(metadata.estimatedDuration / 60)}m
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Characters */}
                <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                    <Users className="h-4 w-4" />
                    Characters
                  </h3>
                  {metadata?.characters && metadata.characters.length > 0 ? (
                    <div className="space-y-2">
                      {metadata.characters.map((character, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800/50"
                        >
                          <div className="h-6 w-6 rounded-full bg-blue-100 dark:bg-blue-900" />
                          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                            {character}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      No characters extracted
                    </p>
                  )}
                </div>

                {/* Locations */}
                {metadata?.locations && metadata.locations.length > 0 && (
                  <div className="bg-card/80 rounded-xl p-4 shadow-sm backdrop-blur-sm">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
                      <MapPin className="h-4 w-4" />
                      Locations
                    </h3>
                    <div className="space-y-2">
                      {metadata.locations.map((location, i) => (
                        <div
                          key={i}
                          className="rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-300"
                        >
                          {location}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
