'use client';

import type { Scene } from '@kit/prompt-engine/schemas';
import { cn } from '@kit/ui/utils';

interface SceneContentProps {
  scene: Scene;
  isActive?: boolean;
}

export function SceneContent({ scene, isActive = false }: SceneContentProps) {
  return (
    <div
      id={`scene-${scene.number}`}
      className={cn(
        'scroll-mt-4 border-b pb-6 last:border-b-0',
        isActive && 'bg-accent/20 rounded-lg p-4',
      )}
    >
      {/* Scene Heading - Uppercase, bold */}
      <div className="mb-4 font-mono text-sm font-bold uppercase">
        {scene.heading}
      </div>

      {/* Location and Time */}
      <div className="text-muted-foreground mb-3 flex gap-4 text-xs">
        <span>Location: {scene.location}</span>
        <span>Time: {scene.timeOfDay}</span>
        <span>Duration: ~{scene.estimatedDuration}s</span>
      </div>

      {/* Action/Description */}
      <div className="mb-4 whitespace-pre-wrap text-sm leading-relaxed">
        {scene.description}
      </div>

      {/* Dialogue */}
      {scene.dialogue.length > 0 && (
        <div className="space-y-4 pl-4">
          {scene.dialogue.map((line, index) => (
            <div key={index} className="text-center">
              <div className="font-mono text-sm font-bold uppercase">
                {line.character}
              </div>
              {line.parenthetical && (
                <div className="text-muted-foreground text-xs italic">
                  ({line.parenthetical})
                </div>
              )}
              <div className="mx-auto max-w-md text-sm">{line.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
