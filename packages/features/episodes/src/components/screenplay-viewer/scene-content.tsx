'use client';

import type { Scene } from '@kit/prompt-engine/schemas';
import { cn } from '@kit/ui/utils';

interface SceneContentProps {
  scene: Scene;
  isActive?: boolean;
}

/**
 * SceneContent renders a single scene in proper screenplay format
 * Uses Courier Prime font for industry-standard timing (1 page ≈ 1 minute)
 */
export function SceneContent({ scene, isActive = false }: SceneContentProps) {
  return (
    <div
      id={`scene-${scene.number}`}
      className={cn(
        'border-border/30 screenplay-format scroll-mt-4 border-b pb-8 last:border-b-0',
        isActive && 'bg-accent/10 -mx-2 rounded-lg px-6 py-4',
      )}
    >
      {/* Scene Heading - Slug Line (uppercase, bold) */}
      <div className="slug-line text-sm">{scene.heading}</div>

      {/* Scene metadata - using mono for timecodes */}
      <div className="text-muted-foreground mono-data mb-4 flex gap-4 text-xs">
        <span>{scene.location}</span>
        <span>•</span>
        <span>{scene.timeOfDay}</span>
        <span>•</span>
        <span>~{scene.estimatedDuration}s</span>
      </div>

      {/* Action/Description Block */}
      <div className="action whitespace-pre-wrap text-sm">
        {scene.description}
      </div>

      {/* Dialogue Blocks */}
      {scene.dialogue.length > 0 && (
        <div className="mt-6 space-y-4">
          {scene.dialogue.map((line, index) => (
            <div key={index}>
              {/* Character Name - centered, uppercase */}
              <div className="character-name text-sm">{line.character}</div>

              {/* Parenthetical - centered, italicized */}
              {line.parenthetical && (
                <div className="parenthetical text-xs">
                  ({line.parenthetical})
                </div>
              )}

              {/* Dialogue Text - centered, narrower width */}
              <div className="dialogue text-sm">{line.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
