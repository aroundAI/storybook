'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  MoreVertical,
  Trash2,
  Volume2,
} from 'lucide-react';
import { toast } from '@kit/ui/sonner';

import type { Episode } from '@kit/episodes/types';
import { deleteSeasonAction } from '@kit/episodes/server';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@kit/ui/alert-dialog';
import { Button } from '@kit/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

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
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPending, startTransition] = useTransition();

  const progressPercent =
    totalEpisodes > 0
      ? Math.round((completedEpisodes / totalEpisodes) * 100)
      : 0;

  function handleDeleteSeason() {
    startTransition(async () => {
      try {
        await deleteSeasonAction({ seasonId });

        toast.success('Season deleted');
        router.refresh();
      } catch {
        toast.error('Failed to delete season');
      } finally {
        setShowDeleteDialog(false);
      }
    });
  }

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
              {seasonName && (
                <span className="ml-2 text-xs font-normal text-gray-500 dark:text-gray-400">
                  {seasonName}
                </span>
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

          {/* Season actions dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
              >
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end">
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onSelect={() => setShowDeleteDialog(true)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Season & Episodes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

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

      {/* Delete Season Confirmation */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Season & All Episodes?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete Season {seasonNumber} and all{' '}
              {totalEpisodes} episodes in it. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSeason}
              disabled={isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isPending ? 'Deleting…' : 'Delete Season'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
