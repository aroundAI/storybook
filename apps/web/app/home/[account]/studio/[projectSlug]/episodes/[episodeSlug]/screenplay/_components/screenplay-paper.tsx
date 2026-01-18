'use client';

import type { ScreenplayScene } from '@kit/episodes/types';
import { cn } from '@kit/ui/utils';

interface ScreenplayPaperProps {
  scenes: ScreenplayScene[];
  activeSceneNumber: number;
}

export function ScreenplayPaper({
  scenes,
  activeSceneNumber,
}: ScreenplayPaperProps) {
  return (
    <div className="mx-auto max-w-3xl">
      {/* Screenplay Paper Container */}
      <div className="bg-card rounded-lg border border-gray-200 shadow-lg">
        {/* Paper Content */}
        <div className="p-12">
          {scenes.map((scene) => (
            <div
              key={scene.number}
              id={`scene-${scene.number}`}
              className={cn(
                'screenplay-scene mb-12 scroll-mt-8 pb-8 transition-colors last:mb-0 last:border-b-0 last:pb-0',
                activeSceneNumber === scene.number &&
                  '-mx-6 rounded-lg bg-blue-50/50 px-6 py-4 dark:bg-blue-900/10',
              )}
            >
              {/* Scene Heading (Slug Line) */}
              <div className="mb-4 font-mono text-sm font-bold tracking-wide text-gray-900 uppercase dark:text-white">
                {scene.heading}
              </div>

              {/* Scene Metadata */}
              <div className="mb-4 flex items-center gap-2 font-mono text-xs text-gray-500 dark:text-gray-400">
                <span>{scene.location}</span>
                <span>•</span>
                <span className="uppercase">{scene.timeOfDay}</span>
                <span>•</span>
                <span>~{scene.estimatedDuration}s</span>
              </div>

              {/* Action/Description */}
              <div className="mb-6 font-mono text-sm leading-relaxed whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {scene.description}
              </div>

              {/* Dialogue */}
              {scene.dialogue.length > 0 && (
                <div className="space-y-6">
                  {scene.dialogue.map((line, index) => (
                    <div key={index} className="dialogue-block">
                      {/* Character Name - Centered, Uppercase */}
                      <div className="mx-auto max-w-[250px] text-center font-mono text-sm font-bold text-gray-900 uppercase dark:text-white">
                        {line.character}
                      </div>

                      {/* Parenthetical - Centered, Italics */}
                      {line.parenthetical && (
                        <div className="mx-auto max-w-[200px] text-center font-mono text-xs text-gray-500 italic dark:text-gray-400">
                          ({line.parenthetical})
                        </div>
                      )}

                      {/* Dialogue Text - Centered, Narrower Width */}
                      <div className="mx-auto max-w-[300px] text-center font-mono text-sm leading-relaxed text-gray-800 dark:text-gray-200">
                        {line.text}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Page Number */}
      <div className="mt-4 text-center font-mono text-xs text-gray-400 dark:text-gray-500">
        {scenes.length} scene{scenes.length !== 1 ? 's' : ''} • ~
        {Math.round(
          scenes.reduce((sum, s) => sum + s.estimatedDuration, 0) / 60,
        )}{' '}
        min
      </div>
    </div>
  );
}
