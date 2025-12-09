'use client';

import type { Scene } from '@kit/prompt-engine/schemas';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { ScrollArea } from '@kit/ui/scroll-area';
import { cn } from '@kit/ui/utils';

interface SceneNavigationProps {
  scenes: Scene[];
  activeSceneNumber: number;
  onSceneSelect: (sceneNumber: number) => void;
}

export function SceneNavigation({
  scenes,
  activeSceneNumber,
  onSceneSelect,
}: SceneNavigationProps) {
  return (
    <ScrollArea className="h-[500px]">
      <div className="space-y-1 pr-4">
        {scenes.map((scene) => (
          <Button
            key={scene.number}
            variant="ghost"
            className={cn(
              'w-full justify-start text-left',
              activeSceneNumber === scene.number && 'bg-accent',
            )}
            onClick={() => onSceneSelect(scene.number)}
          >
            <div className="flex w-full items-center gap-2">
              <Badge variant="outline" className="shrink-0">
                {scene.number}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">
                  {scene.location}
                </div>
                <div className="text-muted-foreground truncate text-xs">
                  {scene.timeOfDay} - {scene.estimatedDuration}s
                </div>
              </div>
            </div>
          </Button>
        ))}
      </div>
    </ScrollArea>
  );
}
