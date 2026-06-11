'use client';

import { useMemo } from 'react';

import { ArrowRight, Clock, MessageSquare, Swords, Zap } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { cn } from '@kit/ui/utils';

import type {
  BulkAction,
  BulkState,
  EpisodeBulkState,
} from '../bulk-generate-modal';
import { statusIndex } from '../bulk-generate-modal';

// ============================================================================
// Duration options
// ============================================================================

const DURATION_OPTIONS = [
  { value: 60, label: '1 min' },
  { value: 120, label: '2 min' },
  { value: 300, label: '5 min' },
  { value: 600, label: '10 min' },
  { value: 900, label: '15 min' },
  { value: 1800, label: '30 min' },
] as const;

const CONTENT_STYLES = [
  { value: 'dialogue-heavy' as const, label: 'Dialogue', icon: MessageSquare },
  { value: 'balanced' as const, label: 'Balanced', icon: Zap },
  { value: 'action-heavy' as const, label: 'Action', icon: Swords },
] as const;

// ============================================================================
// Status badge config
// ============================================================================

const STATUS_BADGE_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  draft: { label: 'Draft', className: 'bg-zinc-700/50 text-zinc-300' },
  story: { label: 'Story', className: 'bg-blue-500/20 text-blue-400' },
  storyboard: {
    label: 'Storyboard',
    className: 'bg-purple-500/20 text-purple-400',
  },
  generating: {
    label: 'Generating',
    className: 'bg-amber-500/20 text-amber-400',
  },
  editing: { label: 'Editing', className: 'bg-orange-500/20 text-orange-400' },
  ready: { label: 'Ready', className: 'bg-emerald-500/20 text-emerald-400' },
  published: {
    label: 'Published',
    className: 'bg-emerald-500/20 text-emerald-400',
  },
};

function durationLabel(seconds: number): string {
  const opt = DURATION_OPTIONS.find((o) => o.value === seconds);
  return opt?.label ?? `${Math.round(seconds / 60)} min`;
}

// ============================================================================
// Props
// ============================================================================

interface SelectionPhaseProps {
  state: BulkState;
  dispatch: React.Dispatch<BulkAction>;
  onNext: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function SelectionPhase({
  state,
  dispatch,
  onNext,
}: SelectionPhaseProps) {
  const episodes = useMemo(
    () =>
      Array.from(state.episodes.values()).sort(
        (a, b) => a.episodeNumber - b.episodeNumber,
      ),
    [state.episodes],
  );

  const selectedCount = useMemo(
    () => episodes.filter((ep) => ep.selected).length,
    [episodes],
  );

  const stats = useMemo(() => {
    const selected = episodes.filter((ep) => ep.selected);
    const alreadyComplete = selected.filter(
      (ep) => statusIndex(ep.currentStatus) >= statusIndex('ready'),
    );
    const needPipeline = selected.filter(
      (ep) => statusIndex(ep.currentStatus) < statusIndex('ready'),
    );
    return {
      selected: selected.length,
      complete: alreadyComplete.length,
      needPipeline: needPipeline.length,
    };
  }, [episodes]);

  return (
    <div className="flex h-full flex-col">
      {/* Top toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'SELECT_ALL' })}
            className="text-xs text-white/60 hover:text-white"
          >
            Select All
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => dispatch({ type: 'DESELECT_ALL' })}
            className="text-xs text-white/60 hover:text-white"
          >
            Deselect All
          </Button>
        </div>

        <div className="h-4 w-px bg-white/10" />

        {/* Batch duration */}
        <div className="flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-white/40" />
          <Select
            onValueChange={(val) =>
              dispatch({ type: 'SET_ALL_DURATIONS', duration: Number(val) })
            }
          >
            <SelectTrigger className="h-7 w-[110px] border-white/10 bg-white/5 text-xs">
              <SelectValue placeholder="Set all..." />
            </SelectTrigger>
            <SelectContent>
              {DURATION_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Batch content style */}
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5">
          {CONTENT_STYLES.map((style) => (
            <button
              key={style.value}
              type="button"
              onClick={() =>
                dispatch({ type: 'SET_ALL_CONTENT_STYLES', style: style.value })
              }
              className="rounded-md px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/10 hover:text-white/80"
            >
              {style.label}
            </button>
          ))}
        </div>
      </div>

      {/* Episode list — fills remaining space */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="divide-y divide-white/5">
          {episodes.map((ep) => (
            <EpisodeRow key={ep.episodeId} episode={ep} dispatch={dispatch} />
          ))}
        </div>
      </div>

      {/* Summary footer */}
      <div className="flex shrink-0 items-center justify-between border-t border-white/10 px-6 py-4">
        <div className="flex items-center gap-4 text-sm text-white/50">
          <span>
            <span className="font-medium text-white">{stats.selected}</span>{' '}
            episode{stats.selected !== 1 ? 's' : ''} selected
          </span>
          {stats.complete > 0 && (
            <span className="text-emerald-400/70">
              {stats.complete} already complete (will be skipped)
            </span>
          )}
          {stats.needPipeline > 0 && (
            <span className="text-blue-400/70">
              {stats.needPipeline} need full pipeline
            </span>
          )}
        </div>

        <Button
          onClick={onNext}
          disabled={selectedCount === 0}
          className="gap-2 bg-blue-600 text-white hover:bg-blue-500"
        >
          Start Bulk Generate
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Episode Row
// ============================================================================

function EpisodeRow({
  episode,
  dispatch,
}: {
  episode: EpisodeBulkState;
  dispatch: React.Dispatch<BulkAction>;
}) {
  const badgeConfig =
    STATUS_BADGE_CONFIG[episode.currentStatus] ?? STATUS_BADGE_CONFIG['draft']!;

  return (
    <div
      className={cn(
        'flex items-center gap-4 px-6 py-3 transition-colors',
        episode.selected ? 'bg-white/[0.02]' : 'opacity-50',
      )}
    >
      {/* Checkbox */}
      <Checkbox
        checked={episode.selected}
        onCheckedChange={() =>
          dispatch({ type: 'TOGGLE_EPISODE', episodeId: episode.episodeId })
        }
        className="border-white/20"
      />

      {/* Episode number */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500/20 to-purple-500/20 text-xs font-semibold text-white/70">
        {String(episode.episodeNumber).padStart(2, '0')}
      </div>

      {/* Title + status */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white/90">
            {episode.title}
          </span>
          <Badge
            className={cn(
              'shrink-0 rounded-full border-0 px-2 py-0.5 text-[10px] font-medium',
              badgeConfig.className,
            )}
          >
            {badgeConfig.label}
          </Badge>
        </div>
      </div>

      {/* Duration dropdown */}
      <Select
        value={String(episode.duration)}
        onValueChange={(val) =>
          dispatch({
            type: 'SET_DURATION',
            episodeId: episode.episodeId,
            duration: Number(val),
          })
        }
      >
        <SelectTrigger className="h-7 w-[100px] border-white/10 bg-white/5 text-xs">
          <SelectValue>{durationLabel(episode.duration)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {DURATION_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Content style pills */}
      <div className="flex items-center gap-0.5">
        {CONTENT_STYLES.map((style) => {
          const Icon = style.icon;
          const isActive = episode.contentStyle === style.value;

          return (
            <button
              key={style.value}
              type="button"
              onClick={() =>
                dispatch({
                  type: 'SET_CONTENT_STYLE',
                  episodeId: episode.episodeId,
                  style: style.value,
                })
              }
              className={cn(
                'rounded-md px-2 py-1 text-[10px] transition-colors',
                isActive
                  ? 'bg-blue-500/20 text-blue-400'
                  : 'text-white/30 hover:bg-white/5 hover:text-white/50',
              )}
              title={style.label}
            >
              <Icon className="h-3 w-3" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
