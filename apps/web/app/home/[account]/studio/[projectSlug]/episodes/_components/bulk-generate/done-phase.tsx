'use client';

import { useMemo } from 'react';

import {
  AlertTriangle,
  BookOpen,
  Camera,
  CheckCircle2,
  Lightbulb,
  ScrollText,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { cn } from '@kit/ui/utils';

import type { BulkState } from '../bulk-generate-modal';

// ============================================================================
// Props
// ============================================================================

interface DonePhaseProps {
  state: BulkState;
  onClose: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function DonePhase({ state, onClose }: DonePhaseProps) {
  const episodes = useMemo(
    () => Array.from(state.episodes.values()).filter((ep) => ep.selected),
    [state.episodes],
  );

  const stats = useMemo(() => {
    const ideasGenerated = episodes.filter(
      (ep) => ep.ideationStatus === 'done',
    ).length;
    const storiesCreated = episodes.filter(
      (ep) => ep.storyStatus === 'done',
    ).length;
    const screenplaysCreated = episodes.filter(
      (ep) => ep.screenplayStatus === 'done',
    ).length;
    const shotListsCreated = episodes.filter(
      (ep) => ep.shotStatus === 'done',
    ).length;
    const errors = episodes.filter((ep) => ep.error);

    return {
      ideasGenerated,
      storiesCreated,
      screenplaysCreated,
      shotListsCreated,
      errors,
    };
  }, [episodes]);

  const totalCompleted =
    stats.ideasGenerated +
    stats.storiesCreated +
    stats.screenplaysCreated +
    stats.shotListsCreated;

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-6 py-10">
      {/* Success icon */}
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10">
        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
      </div>

      <h3 className="mt-5 text-lg font-semibold text-white">
        Bulk Generation Complete
      </h3>
      <p className="mt-1.5 text-sm text-white/50">
        {totalCompleted > 0
          ? `Successfully processed ${episodes.length} episode${episodes.length !== 1 ? 's' : ''}`
          : 'No items were generated'}
      </p>

      {/* Stats grid */}
      <div className="mt-8 grid w-full max-w-md grid-cols-2 gap-3">
        <StatCard
          icon={Lightbulb}
          label="Ideas generated"
          count={stats.ideasGenerated}
          color="amber"
        />
        <StatCard
          icon={BookOpen}
          label="Stories created"
          count={stats.storiesCreated}
          color="blue"
        />
        <StatCard
          icon={ScrollText}
          label="Screenplays created"
          count={stats.screenplaysCreated}
          color="purple"
        />
        <StatCard
          icon={Camera}
          label="Shot lists created"
          count={stats.shotListsCreated}
          color="emerald"
        />
      </div>

      {/* Error list */}
      {stats.errors.length > 0 && (
        <div className="mt-6 w-full max-w-md rounded-lg border border-red-500/20 bg-red-500/5 p-4">
          <h4 className="flex items-center gap-2 text-sm font-medium text-red-400">
            <AlertTriangle className="h-4 w-4" />
            {stats.errors.length} error{stats.errors.length !== 1 ? 's' : ''}{' '}
            occurred
          </h4>
          <div className="mt-3 space-y-2">
            {stats.errors.map((ep) => (
              <div
                key={ep.episodeId}
                className="flex items-start gap-2 text-xs"
              >
                <span className="shrink-0 font-medium text-white/60">
                  Ep {String(ep.episodeNumber).padStart(2, '0')}:{' '}
                  {ep.title}
                </span>
                <span className="text-red-400/80">{ep.error}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Close button */}
      <Button
        onClick={onClose}
        className="mt-8 gap-2 bg-blue-600 px-8 text-white hover:bg-blue-500"
      >
        Close
      </Button>
    </div>
  );
}

// ============================================================================
// Stat Card
// ============================================================================

const COLOR_MAP = {
  amber: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    count: 'text-amber-300',
  },
  blue: {
    bg: 'bg-blue-500/10',
    text: 'text-blue-400',
    count: 'text-blue-300',
  },
  purple: {
    bg: 'bg-purple-500/10',
    text: 'text-purple-400',
    count: 'text-purple-300',
  },
  emerald: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    count: 'text-emerald-300',
  },
} as const;

function StatCard({
  icon: Icon,
  label,
  count,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  color: keyof typeof COLOR_MAP;
}) {
  const colors = COLOR_MAP[color];

  return (
    <div
      className={cn(
        'rounded-xl border border-white/5 p-4',
        colors.bg,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn('h-4 w-4', colors.text)} />
        <span className="text-xs text-white/50">{label}</span>
      </div>
      <p className={cn('mt-2 text-2xl font-bold', colors.count)}>{count}</p>
    </div>
  );
}
