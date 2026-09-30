'use client';

import type { ScreenplayScene } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface SceneIndexSidebarProps {
  scenes: ScreenplayScene[];
  activeSceneNumber: number;
  onSceneSelect: (sceneNumber: number) => void;
}

export function SceneIndexSidebar({
  scenes,
  activeSceneNumber,
  onSceneSelect,
}: SceneIndexSidebarProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4">
        <h3 className="mb-4 text-xs font-semibold tracking-wider text-gray-600 uppercase dark:text-gray-500">
          Scene Index
        </h3>

        <div className="space-y-1">
          {scenes.map((scene) => (
            <button
              key={scene.number}
              data-test={`scene-index-item-${scene.number}`}
              onClick={() => onSceneSelect(scene.number)}
              className={cn(
                'group flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                activeSceneNumber === scene.number
                  ? 'bg-blue-50 dark:bg-blue-900/20'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
            >
              {/* Scene Number Badge */}
              <span
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold',
                  activeSceneNumber === scene.number
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600 group-hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-400 dark:group-hover:bg-gray-600',
                )}
              >
                {scene.number}
              </span>

              {/* Scene Info */}
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    'truncate text-xs font-medium',
                    activeSceneNumber === scene.number
                      ? 'text-blue-700 dark:text-blue-400'
                      : 'text-gray-700 dark:text-gray-300',
                  )}
                >
                  {scene.location}
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500">
                  <span className="uppercase">{scene.timeOfDay}</span>
                  <span>•</span>
                  <span>{scene.estimatedDuration}s</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
