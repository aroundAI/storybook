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
        'screenplay-format scroll-mt-4 border-b border-border/30 pb-8 last:border-b-0',
        isActive && '-mx-2 rounded-lg bg-accent/10 px-6 py-4',
      )}
    >
      {/* Scene Heading - Slug Line (uppercase, bold) */}
      <div className="slug-line text-sm">{scene.heading}</div>

      {/* Scene metadata - using mono for timecodes */}
      <div className="mono-data mb-4 flex gap-4 text-xs text-muted-foreground">
        <span>{scene.location}</span>
        <span>•</span>
        <span>{scene.timeOfDay}</span>
        <span>•</span>
        <span>~{scene.estimatedDuration}s</span>
      </div>

      {/* Action/Description Block */}
      <div className="action text-sm whitespace-pre-wrap">
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
