'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Pencil,
  Volume2,
} from 'lucide-react';

import { updateSeasonAction } from '@kit/episodes/server';
import type { Episode } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';

import { GenerateAllSoundModal } from './generate-all-sound-modal';

interface SeasonAnalyticsSummary {
  totalViews: number;
  avgEngagementRate: number;
}

interface AudioStats {
  dialogueTotal: number;
  dialogueCompleted: number;
  musicTotal: number;
  musicCompleted: number;
  sfxTotal: number;
  sfxCompleted: number;
}

interface SeasonHeaderProps {
  seasonId: string;
  seasonNumber: number;
  seasonName?: string;
  totalEpisodes: number;
  completedEpisodes: number;
  inProgressEpisodes: number;
  projectId: string;
  episodes: Episode[];
  audioStatsMap?: Map<string, AudioStats>;
  analytics?: SeasonAnalyticsSummary | null;
  onGenerateSeason?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SeasonHeader({
  seasonId,
  seasonNumber,
  seasonName,
  totalEpisodes,
  completedEpisodes,
  projectId,
  episodes,
  audioStatsMap,
  isCollapsed = false,
  onToggleCollapse,
}: SeasonHeaderProps) {
  const [showModal, setShowModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(seasonName ?? '');
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync editValue when seasonName prop changes
  useEffect(() => {
    if (!isEditing) {
      setEditValue(seasonName ?? '');
    }
  }, [seasonName, isEditing]);

  // Auto-focus input when entering edit mode
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    const trimmed = editValue.trim();
    setIsEditing(false);

    // Skip if unchanged
    if (trimmed === (seasonName ?? '')) return;

    startTransition(async () => {
      try {
        await updateSeasonAction({
          seasonId,
          name: trimmed || `Season ${seasonNumber}`,
        });
        toast.success('Season name updated');
      } catch {
        setEditValue(seasonName ?? '');
        toast.error('Failed to update season name');
      }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      setEditValue(seasonName ?? '');
      setIsEditing(false);
    }
  };

  const progressPercent =
    totalEpisodes > 0
      ? Math.round((completedEpisodes / totalEpisodes) * 100)
      : 0;

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
        <div className="flex items-center gap-4">
          {/* Icon */}
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-800 dark:text-blue-300">
            <FolderOpen className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Season {seasonNumber}
              {isEditing ? (
                <Input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={handleSave}
                  onKeyDown={handleKeyDown}
                  disabled={isPending}
                  className="ml-2 inline-block h-6 w-48 text-xs font-normal"
                  placeholder={`Season ${seasonNumber}`}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  className="group/rename ml-2 inline-flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:bg-blue-100 dark:hover:bg-blue-800/50"
                >
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {seasonName || 'Add name...'}
                  </span>
                  <Pencil className="h-3 w-3 text-gray-400 opacity-0 transition-opacity group-hover/rename:opacity-100 dark:text-gray-500" />
                </button>
              )}
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {totalEpisodes} {totalEpisodes === 1 ? 'episode' : 'episodes'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Generate All Sound button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowModal(true)}
            className="gap-2 border-violet-200 text-violet-600 hover:bg-violet-50 dark:border-violet-800 dark:text-violet-400 dark:hover:bg-violet-950"
          >
            <Volume2 className="h-4 w-4" />
            <span className="hidden sm:inline">Generate All Sound</span>
          </Button>

          {/* Completion percentage */}
          <div className="text-right">
            <div className="text-lg font-bold text-blue-600 dark:text-blue-400">
              {progressPercent}%
            </div>
            <div className="text-[10px] font-bold tracking-wider text-gray-400 uppercase dark:text-gray-500">
              Complete
            </div>
          </div>

          {/* Collapse/Expand toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-gray-400 transition-colors hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            {isCollapsed ? (
              <ChevronDown className="h-6 w-6" />
            ) : (
              <ChevronUp className="h-6 w-6" />
            )}
          </button>
        </div>
      </div>

      {/* Generate All Sound Modal */}
      <GenerateAllSoundModal
        open={showModal}
        onOpenChange={setShowModal}
        seasonId={seasonId}
        seasonNumber={seasonNumber}
        projectId={projectId}
        episodes={episodes}
        audioStatsMap={audioStatsMap}
      />
    </>
  );
}
