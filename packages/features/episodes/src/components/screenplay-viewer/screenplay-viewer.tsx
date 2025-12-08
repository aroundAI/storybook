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
import { ScrollArea } from '@kit/ui/scroll-area';
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

  // Transform the stored ScreenplayData format to the Screenplay schema format
  const scenes: Scene[] = screenplayData.scenes.map((scene) => ({
    number: scene.number,
    heading: `${scene.timeOfDay.toUpperCase()}. ${scene.location.toUpperCase()} - ${scene.timeOfDay.toUpperCase()}`,
    location: scene.location,
    timeOfDay: scene.timeOfDay,
    description: scene.description,
    dialogue: (screenplayData.dialogue ?? [])
      .filter((d) => d.sceneNumber === scene.number)
      .map((d) => ({
        character: d.characterName,
        text: d.text,
        parenthetical: d.emotion,
      })),
    estimatedDuration: scene.duration,
  }));

  return {
    scenes,
    metadata: {
      totalScenes: scenes.length,
      estimatedDuration: scenes.reduce(
        (acc, s) => acc + s.estimatedDuration,
        0,
      ),
      locations: [...new Set(scenes.map((s) => s.location))],
      characters: [
        ...new Set((screenplayData.dialogue ?? []).map((d) => d.characterName)),
      ],
    },
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
    <Card className="mt-4">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5" />
            <div>
              <CardTitle>Screenplay</CardTitle>
              <CardDescription>
                {screenplay.metadata.totalScenes} scenes - ~
                {Math.round(screenplay.metadata.estimatedDuration / 60)} min
              </CardDescription>
            </div>
          </div>
          <div className="flex gap-2">
            {onRegenerate && (
              <Button
                variant="outline"
                onClick={onRegenerate}
                disabled={isPending}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Regenerate
              </Button>
            )}
            <Button onClick={handleApprove} disabled={isPending}>
              {isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Approve & Continue
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 lg:grid-cols-[200px_1fr]">
          {/* Scene Navigation Sidebar */}
          <div className="hidden lg:block">
            <div className="mb-2 text-sm font-medium">Scenes</div>
            <SceneNavigation
              scenes={screenplay.scenes}
              activeSceneNumber={activeSceneNumber}
              onSceneSelect={scrollToScene}
            />
          </div>

          {/* Main Screenplay Content */}
          <ScrollArea className="h-[500px]">
            <div ref={contentRef} className="space-y-6 pr-4">
              {screenplay.scenes.map((scene) => (
                <SceneContent
                  key={scene.number}
                  scene={scene}
                  isActive={activeSceneNumber === scene.number}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </CardContent>
    </Card>
  );
}
