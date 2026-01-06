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
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

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
  const [isPending, startTransition] = useTransition();
  const [activeSceneNumber, setActiveSceneNumber] = useState(1);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const scenes = parseScenes(episode.screenplayData);
  const metadata = episode.screenplayData?.metadata;
  const hasShotList = Boolean(episode.shotList) || episode.shots.length > 0;

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
    startTransition(async () => {
      try {
        const result = await generateShotListAction({
          episodeId: episode.id,
          shotDurationMin: 5,
          shotDurationMax: 8,
          videoProvider: 'kling',
        });

        if (result.success) {
          toast.success(
            `Shot list generated with ${result.shotsCreated} shots`,
          );
          refetchEpisode();
          onShotListComplete();
        }
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : 'Failed to generate shot list',
        );
      }
    });
  };

  if (!scenes.length) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            No Screenplay
          </h2>
          <p className="text-gray-500 dark:text-gray-400">
            Convert your story to screenplay format first.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-black/5 bg-card/85 px-6 py-3 backdrop-blur-xl">
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
              className="gap-2 bg-green-600 text-white hover:bg-green-700"
            >
              View Shot List
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              onClick={handleGenerateShotList}
              disabled={isPending}
              className="gap-2 bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
            >
              {isPending ? (
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
        <div className="w-56 shrink-0 border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
          <SceneIndexSidebar
            scenes={scenes}
            activeSceneNumber={activeSceneNumber}
            onSceneSelect={scrollToScene}
          />
        </div>

        {/* Center - Screenplay Paper */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto bg-gray-100 p-8 dark:bg-gray-900"
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
            'fixed top-1/2 right-0 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-white/30 bg-card/70 p-3 shadow-lg backdrop-blur-xl transition-all hover:bg-card/90 dark:hover:bg-gray-800/90',
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
            'fixed top-0 right-0 z-30 h-full w-80 transform border-l border-white/20 bg-card/60 shadow-2xl backdrop-blur-xl transition-transform duration-300',
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
                  <div className="rounded-xl bg-card/80 p-4 shadow-sm backdrop-blur-sm">
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
                <div className="rounded-xl bg-card/80 p-4 shadow-sm backdrop-blur-sm">
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
                  <div className="rounded-xl bg-card/80 p-4 shadow-sm backdrop-blur-sm">
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
