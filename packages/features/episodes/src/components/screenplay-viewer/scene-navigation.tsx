'use client';

import type { Scene } from '@kit/prompt-engine/schemas';
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
    <div className="space-y-2">
      {scenes.map((scene) => {
        const isActive = activeSceneNumber === scene.number;

        return (
          <div
            key={scene.number}
            onClick={() => onSceneSelect(scene.number)}
            className={cn(
              'group relative mb-2 flex cursor-pointer rounded-md border p-3 transition-all',
              isActive
                ? 'border-border/50 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.05)] ring-1 ring-black/5'
                : 'border-transparent hover:bg-white hover:shadow-[0_2px_8px_rgba(0,0,0,0.05)]',
            )}
          >
            <div className="mr-3 pt-0.5">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold',
                  isActive
                    ? 'bg-gray-100 text-gray-500'
                    : 'bg-gray-200 text-gray-500 group-hover:bg-gray-100',
                )}
              >
                {scene.number}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div
                className={cn(
                  'mb-1.5 truncate text-sm leading-none',
                  isActive
                    ? 'font-bold text-gray-800'
                    : 'font-medium text-gray-600 group-hover:text-gray-900',
                )}
              >
                {scene.location}
              </div>
              <div className="flex items-center text-[10px]">
                <span
                  className={cn(
                    'mr-2 rounded px-1.5 py-0.5 font-bold uppercase tracking-wide',
                    isActive
                      ? 'bg-gray-100 text-gray-500'
                      : 'border border-gray-200 text-gray-400',
                  )}
                >
                  {scene.timeOfDay}
                </span>
                <span className="text-gray-400">
                  {scene.estimatedDuration}s
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
