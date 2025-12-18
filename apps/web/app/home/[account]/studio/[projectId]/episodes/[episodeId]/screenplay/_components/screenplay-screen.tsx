'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { ArrowRight, Check, Loader2 } from 'lucide-react';

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
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
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
    <div className="flex h-full flex-col">
      {/* Header Bar */}
      <div className="flex items-center justify-between border-b border-black/5 bg-white/85 px-6 py-3 backdrop-blur-xl dark:border-white/5 dark:bg-gray-800/85">
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

      {/* Main Content - Three Column Layout */}
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

        {/* Right Sidebar - Characters & Info */}
        <div className="w-64 shrink-0 overflow-y-auto border-l border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
          <div className="p-4">
            <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
              Characters
            </h3>
            {metadata?.characters && metadata.characters.length > 0 ? (
              <div className="space-y-2">
                {metadata.characters.map((character, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-700"
                  >
                    <div className="h-8 w-8 rounded-full bg-blue-100 dark:bg-blue-900" />
                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      {character}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No characters extracted
              </p>
            )}

            {metadata?.locations && metadata.locations.length > 0 && (
              <div className="mt-6">
                <h3 className="mb-4 text-sm font-semibold text-gray-900 dark:text-white">
                  Locations
                </h3>
                <div className="space-y-2">
                  {metadata.locations.map((location, i) => (
                    <div
                      key={i}
                      className={cn(
                        'rounded-lg px-3 py-2 text-sm',
                        'bg-gray-50 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                      )}
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
  );
}
