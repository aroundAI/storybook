'use client';

import { useState } from 'react';

import { ChevronDown, ChevronUp, Flame, Info } from 'lucide-react';

import type { EpisodeViralQuality } from '@kit/episodes/types';
import { Badge } from '@kit/ui/badge';
import { cn } from '@kit/ui/utils';

interface ViralScorecardProps {
  viralQuality: EpisodeViralQuality;
}

export function ViralScorecard({ viralQuality }: ViralScorecardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b border-orange-500/20 bg-orange-500/5 px-6 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-500" />
            <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">
              Episode Viral Scorecard
            </span>
          </div>
          {/* Score ring */}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold',
                viralQuality.overallScore >= 0.75
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                  : viralQuality.overallScore >= 0.65
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
              )}
            >
              {Math.round(viralQuality.overallScore * 100)}
            </div>
            <Badge
              variant="secondary"
              className={cn(
                'text-xs capitalize',
                viralQuality.decision === 'pass'
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                  : viralQuality.decision === 'revised'
                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300',
              )}
            >
              {viralQuality.decision}
            </Badge>
            {viralQuality.orchestratorSteps > 0 && (
              <span className="text-xs text-gray-400">
                {viralQuality.orchestratorSteps} agent steps
              </span>
            )}
          </div>
          {/* Teaser: whyThisWorks — truncated on collapsed */}
          {!expanded && viralQuality.whyThisWorks && (
            <p className="line-clamp-1 max-w-xl text-xs text-gray-600 dark:text-gray-400">
              {viralQuality.whyThisWorks}
            </p>
          )}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-800 dark:text-orange-400 dark:hover:text-orange-300"
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" /> Collapse
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" /> Expand
              <Info className="ml-0.5 h-3 w-3" />
            </>
          )}
        </button>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div className="mt-3 grid grid-cols-2 gap-4">
          {/* Why it works */}
          {viralQuality.whyThisWorks && (
            <div className="rounded-lg bg-green-50 p-3 dark:bg-green-950/30">
              <p className="mb-1 text-xs font-semibold text-green-700 dark:text-green-400">
                ✓ Why this episode works virally
              </p>
              <p className="text-xs leading-relaxed text-green-900 dark:text-green-200">
                {viralQuality.whyThisWorks}
              </p>
            </div>
          )}

          {/* What to improve */}
          {viralQuality.whatToImprove && (
            <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-950/30">
              <p className="mb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                ⚡ What to improve
              </p>
              <p className="text-xs leading-relaxed text-amber-900 dark:text-amber-200">
                {viralQuality.whatToImprove}
              </p>
            </div>
          )}

          {/* Dimension bars */}
          {viralQuality.dimensionScores && (
            <div className="col-span-2 rounded-lg bg-white/50 p-3 dark:bg-white/5">
              <p className="mb-2 text-xs font-semibold text-gray-600 dark:text-gray-400">
                7-Dimension Breakdown
              </p>
              <div className="grid grid-cols-4 gap-x-4 gap-y-2">
                {Object.entries(viralQuality.dimensionScores).map(
                  ([dim, score]) => (
                    <div key={dim}>
                      <div className="mb-0.5 flex items-center justify-between">
                        <span className="text-xs text-gray-500 capitalize dark:text-gray-400">
                          {dim.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                          {Math.round((score as number) * 100)}
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
                        <div
                          className={cn(
                            'h-full rounded-full',
                            (score as number) >= 0.7
                              ? 'bg-green-500'
                              : (score as number) >= 0.5
                                ? 'bg-amber-500'
                                : 'bg-red-500',
                          )}
                          style={{ width: `${(score as number) * 100}%` }}
                        />
                      </div>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}

          {/* Top Reel Candidates */}
          {viralQuality.reelCandidates &&
            viralQuality.reelCandidates.length > 0 && (
              <div className="col-span-2">
                <p className="mb-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
                  🎬 Top Reel Candidates
                </p>
                <div className="flex flex-wrap gap-2">
                  {viralQuality.reelCandidates
                    .sort((a, b) => b.viralScore - a.viralScore)
                    .slice(0, 4)
                    .map((c) => (
                      <div
                        key={c.sceneNumber}
                        className="flex items-center gap-1.5 rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-800 dark:bg-orange-900/40 dark:text-orange-300"
                      >
                        <Flame className="h-3 w-3" />
                        <span>Scene {c.sceneNumber}</span>
                        {c.hookType && (
                          <span className="capitalize opacity-70">
                            · {c.hookType}
                          </span>
                        )}
                        <span className="font-bold">
                          {c.viralScore.toFixed(1)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}

          {/* Revisions applied */}
          {viralQuality.revisionsApplied &&
            viralQuality.revisionsApplied.length > 0 && (
              <div className="col-span-2">
                <p className="mb-1 text-xs font-medium text-blue-600 dark:text-blue-400">
                  🔄 Orchestrator revisions applied
                </p>
                <ul className="space-y-0.5">
                  {viralQuality.revisionsApplied.map((r, i) => (
                    <li
                      key={i}
                      className="text-xs text-gray-500 dark:text-gray-400"
                    >
                      • {r}
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
