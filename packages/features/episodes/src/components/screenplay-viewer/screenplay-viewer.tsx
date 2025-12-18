'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { Check, Film, Loader2, RefreshCw } from 'lucide-react';

import type { Scene, Screenplay } from '@kit/prompt-engine/schemas';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';

import type { EpisodeWithShots, ScreenplayData } from '../../lib/types';
import { SceneContent } from './scene-content';
import { SceneNavigation } from './scene-navigation';

interface ScreenplayViewerProps {
  episode: EpisodeWithShots;
  onApprove: () => void;
  onRegenerate?: () => void;
}

function parseScreenplayData(
  screenplayData: ScreenplayData | null,
): Screenplay | null {
  if (!screenplayData?.scenes?.length) {
    return null;
  }

  // The new ScreenplayData format already matches the Screenplay schema
  // Just map the scenes and use the existing metadata
  const scenes: Scene[] = screenplayData.scenes.map((scene) => ({
    number: scene.number,
    heading: scene.heading,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    description: scene.description,
    dialogue: scene.dialogue,
    estimatedDuration: scene.estimatedDuration,
  }));

  return {
    scenes,
    metadata: screenplayData.metadata,
  };
}

export function ScreenplayViewer({
  episode,
  onApprove,
  onRegenerate,
}: ScreenplayViewerProps) {
  const [isPending, startTransition] = useTransition();
  const [activeSceneNumber, setActiveSceneNumber] = useState(1);
  const contentRef = useRef<HTMLDivElement>(null);

  const screenplay = parseScreenplayData(episode.screenplayData);

  const scrollToScene = useCallback((sceneNumber: number) => {
    setActiveSceneNumber(sceneNumber);

    const element = document.getElementById(`scene-${sceneNumber}`);

    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  // Track active scene on scroll
  useEffect(() => {
    if (!screenplay) return;

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
      { threshold: 0.5, rootMargin: '-100px 0px -50% 0px' },
    );

    screenplay.scenes.forEach((scene) => {
      const element = document.getElementById(`scene-${scene.number}`);

      if (element) {
        observer.observe(element);
      }
    });

    return () => observer.disconnect();
  }, [screenplay]);

  const handleApprove = () => {
    startTransition(async () => {
      try {
        // In a full implementation, this would update the episode with approvedAt
        toast.success('Screenplay approved');
        onApprove();
      } catch {
        toast.error('Failed to approve screenplay');
      }
    });
  };

  if (!screenplay) {
    return (
      <Card className="mt-4">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5" />
            <CardTitle>Screenplay</CardTitle>
          </div>
          <CardDescription>
            Generate a screenplay from the approved story
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-8 text-center">
            <Film className="text-muted-foreground mx-auto mb-4 h-12 w-12" />
            <p className="text-muted-foreground">No screenplay generated yet</p>
            <p className="text-muted-foreground mt-2 text-sm">
              Screenplay conversion will be available in FILM-306
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mt-6 flex h-[calc(100vh-200px)] overflow-hidden">
      {/* Scene Index Sidebar (300px) */}
      <aside className="border-border/40 bg-sidebar-secondary/30 flex w-[300px] flex-shrink-0 flex-col border-r">
        <div className="border-border/40 flex h-14 items-center justify-between border-b px-4">
          <span className="text-muted-foreground/70 text-xs font-bold uppercase tracking-wider">
            Scene Index
          </span>
          <span className="text-muted-foreground/50 text-xs">
            {screenplay.metadata.totalScenes} Scenes • ~
            {Math.round(screenplay.metadata.estimatedDuration / 60)} min
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <SceneNavigation
            scenes={screenplay.scenes}
            activeSceneNumber={activeSceneNumber}
            onSceneSelect={scrollToScene}
          />
        </div>
      </aside>

      {/* Main Screenplay Paper (Centered, scrollable) */}
      <div className="bg-main-bg relative flex flex-1 justify-center overflow-y-auto px-4 py-8">
        <div className="font-screenplay shadow-apple-lg relative mb-20 min-h-[1100px] w-[800px] bg-white p-[1in] text-[16px] leading-[1.2] text-black">
          {/* Page Number */}
          <div className="absolute right-10 top-10 font-sans text-xs text-gray-400">
            p. 1
          </div>

          {/* Approve Button (Floating top-right) */}
          <div className="absolute right-8 top-6 z-10">
            <Button
              onClick={handleApprove}
              disabled={isPending}
              size="sm"
              className="bg-primary shadow-apple rounded-full px-5 py-2 text-xs font-bold transition-transform hover:-translate-y-0.5"
            >
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve Screenplay
            </Button>
          </div>

          {/* Screenplay Content */}
          <div ref={contentRef} className="space-y-8 pt-16">
            {screenplay.scenes.map((scene) => (
              <SceneContent
                key={scene.number}
                scene={scene}
                isActive={activeSceneNumber === scene.number}
              />
            ))}
          </div>
        </div>
      </div>

      {/* AI Assistant Sidebar (280px) */}
      <aside className="border-border/40 bg-sidebar-secondary/30 flex w-[280px] flex-shrink-0 flex-col overflow-y-auto border-l p-4">
        <h2 className="text-muted-foreground/70 mb-4 text-xs font-bold uppercase">
          AI Assistant
        </h2>

        <div className="space-y-4">
          {/* Scene Description Card */}
          <div className="liquid-card-light shadow-apple space-y-3 p-4">
            <div className="text-primary flex items-center space-x-2">
              <Film className="h-4 w-4" />
              <span className="text-xs font-semibold">Scene Description</span>
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Consider adding more detail about the paper texture of the
              environment. How does it sound?
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              disabled
            >
              Generate Suggestion
            </Button>
          </div>

          {/* Active Characters Card */}
          <div className="liquid-card-light shadow-apple space-y-3 p-4">
            <span className="text-foreground text-xs font-semibold">
              Active Characters
            </span>
            <div className="space-y-2">
              {screenplay.scenes
                .find((s) => s.number === activeSceneNumber)
                ?.dialogue.reduce((chars, line) => {
                  if (!chars.includes(line.character)) {
                    chars.push(line.character);
                  }
                  return chars;
                }, [] as string[])
                .map((char, idx) => (
                  <div key={char} className="flex items-center">
                    <div
                      className={`mr-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        idx === 0
                          ? 'bg-blue-100 text-blue-600'
                          : idx === 1
                            ? 'bg-purple-100 text-purple-600'
                            : 'bg-yellow-100 text-yellow-700'
                      }`}
                    >
                      {char.charAt(0)}
                    </div>
                    <span className="text-xs font-medium">{char}</span>
                  </div>
                ))}
            </div>
          </div>

          {/* Dialogue Enhancements Card */}
          <div className="liquid-card-light shadow-apple space-y-2 p-4 opacity-60">
            <span className="text-foreground text-xs font-semibold">
              Character Dialogue Enhancements
            </span>
            <p className="text-muted-foreground text-[10px] italic">
              Suggestions will appear here
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="w-full text-xs"
              disabled
            >
              Generate Suggestion
            </Button>
          </div>
        </div>

        {onRegenerate && (
          <div className="mt-auto pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={onRegenerate}
              disabled={isPending}
              className="text-muted-foreground hover:text-foreground w-full"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Regenerate
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
