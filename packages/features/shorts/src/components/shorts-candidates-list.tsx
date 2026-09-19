'use client';

import { useMemo, useState, useTransition } from 'react';

import { Flame, Loader2, Scissors, Star, Zap } from 'lucide-react';

import { Button } from '@kit/ui/button';

import { generateShortAction } from '../server/generate-short-action';
import type { ShortCandidate } from '../server/shorts-queries';

interface ShortsCandidatesListProps {
  candidates: ShortCandidate[];
  episodeId: string;
  onShortGenerated?: (shortId: string) => void;
}

function getHookTypeIcon(hookType: string | null) {
  switch (hookType) {
    case 'humor':
      return '😂';
    case 'reveal':
      return '✨';
    case 'conflict':
      return '⚡';
    case 'visual':
      return '👁️';
    case 'cliffhanger':
      return '🎬';
    case 'question':
      return '❓';
    default:
      return '🎯';
  }
}

function getViralScoreBadge(score: number | null) {
  if (!score) return null;

  if (score >= 8) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-300">
        <Flame className="h-3 w-3" />
        {score}
      </span>
    );
  }

  if (score >= 5) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300">
        <Star className="h-3 w-3" />
        {score}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
      {score}
    </span>
  );
}

export function ShortsCandidatesList({
  candidates,
  episodeId,
  onShortGenerated,
}: ShortsCandidatesListProps) {
  const [isPending, startTransition] = useTransition();
  const [generatingId, setGeneratingId] = useState<string | null>(null);

  const handleGenerateShort = (shotId: string) => {
    setGeneratingId(shotId);
    startTransition(async () => {
      try {
        const result = await generateShortAction({
          episodeId,
          shotId,
          cropMode: 'center',
        });

        if (result.success && result.shortId) {
          onShortGenerated?.(result.shortId);
        }
      } finally {
        setGeneratingId(null);
      }
    });
  };

  if (candidates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-8 text-center dark:border-gray-700">
        <Scissors className="mb-3 h-10 w-10 text-gray-400" />
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          No Shorts Candidates
        </h3>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          No shots have been flagged as shorts-worthy yet.
          <br />
          Generate shots with viral potential to see candidates here.
        </p>
      </div>
    );
  }

  // Sort by viral score descending
  const sortedCandidates = useMemo(
    () =>
      [...candidates].sort((a, b) => (b.viralScore ?? 0) - (a.viralScore ?? 0)),
    [candidates],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-900 dark:text-white">
          Shorts Candidates ({candidates.length})
        </h3>
        <span className="text-xs text-gray-500">Sorted by viral potential</span>
      </div>

      <div className="space-y-2">
        {sortedCandidates.map((candidate) => (
          <div
            key={candidate.id}
            className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 dark:border-gray-700 dark:bg-gray-800 dark:hover:border-gray-600"
          >
            {/* Shot number */}
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-medium text-gray-700 dark:bg-gray-700 dark:text-gray-300">
              {candidate.sequenceNumber}
            </div>

            {/* Content */}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {getViralScoreBadge(candidate.viralScore)}
                {candidate.hookType && (
                  <span className="text-sm" title={candidate.hookType}>
                    {getHookTypeIcon(candidate.hookType)}
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {candidate.durationSeconds?.toFixed(1)}s
                </span>
              </div>

              {candidate.standaloneSummary && (
                <p className="mt-1 line-clamp-1 text-xs text-gray-600 dark:text-gray-400">
                  {candidate.standaloneSummary}
                </p>
              )}
            </div>

            {/* Generate button */}
            <Button
              size="sm"
              variant="outline"
              disabled={isPending}
              onClick={() => handleGenerateShort(candidate.id)}
              className="flex-shrink-0"
            >
              {generatingId === candidate.id ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Zap className="mr-1 h-3 w-3" />
                  Generate
                </>
              )}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
