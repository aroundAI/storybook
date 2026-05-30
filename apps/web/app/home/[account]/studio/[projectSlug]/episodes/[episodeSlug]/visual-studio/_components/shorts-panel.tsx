'use client';

import { Flame, Sparkles } from 'lucide-react';

import type { Shot } from '@kit/episodes/types';

export interface ShortsCandidateScene {
  sceneNumber: number;
  shots: Shot[];
  viralScore: number;
  estimatedDurationSeconds: number;
  hookType?: string;
  standaloneSummary?: string;
}

interface ShortsPanelProps {
  shortsCandidateScenes: ShortsCandidateScene[];
  onSceneFilter: (sceneNumber: number | undefined) => void;
  currentSceneFilter: number | undefined;
}

export function ShortsPanel({
  shortsCandidateScenes,
  onSceneFilter,
  currentSceneFilter,
}: ShortsPanelProps) {
  if (shortsCandidateScenes.length === 0) return null;

  return (
    <div className="border-b border-orange-500/20 bg-gradient-to-r from-orange-950/20 to-red-950/10 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-orange-400" />
          <span className="text-sm font-semibold text-orange-300">
            {shortsCandidateScenes.length} Reel
            {shortsCandidateScenes.length === 1 ? '' : 's'}
          </span>
          <span className="text-xs text-gray-500">
            — complete scenes flagged by AI as standalone reels (30-60s)
          </span>
        </div>
        <div className="flex items-center gap-2">
          {shortsCandidateScenes.slice(0, 5).map((scene) => (
            <button
              key={scene.sceneNumber}
              onClick={() =>
                onSceneFilter(
                  currentSceneFilter === scene.sceneNumber
                    ? undefined
                    : scene.sceneNumber,
                )
              }
              title={scene.standaloneSummary ?? `Scene ${scene.sceneNumber}`}
              className="flex items-center gap-1.5 rounded-full border border-orange-500/30 bg-orange-900/30 px-2.5 py-1 text-xs font-medium text-orange-300 transition-all hover:bg-orange-900/50"
            >
              <Flame className="h-3 w-3" />
              Scene {scene.sceneNumber}
              <span className="text-orange-400/70">·</span>
              <span className="font-bold text-orange-200">
                {scene.viralScore}/10
              </span>
              <span className="text-orange-500/60">
                ~{Math.round(scene.estimatedDurationSeconds)}s
              </span>
            </button>
          ))}
          {shortsCandidateScenes.length > 5 && (
            <span className="text-xs text-gray-500">
              +{shortsCandidateScenes.length - 5} more
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
