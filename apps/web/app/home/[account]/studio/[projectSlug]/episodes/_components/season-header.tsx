'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  ChevronDown,
  ChevronUp,
  FolderOpen,
  Loader2,
  MoreVertical,
  Pencil,
  RotateCcw,
  StickyNote,
  Trash2,
  Volume2,
  Wand2,
} from 'lucide-react';

import {
  bulkResetToStageAction,
  deleteSeasonAction,
  updateSeasonAction,
} from '@kit/episodes/server';
import type { Episode } from '@kit/episodes/types';
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { toast } from '@kit/ui/sonner';

import { BulkGenerateModal } from './bulk-generate-modal';
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
  accountId: string;
  episodes: Episode[];
  audioStatsMap?: Map<string, AudioStats>;
  analytics?: SeasonAnalyticsSummary | null;
  onGenerateSeason?: () => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  seasonDescription?: string | null;
  directionNotes?: string | null;
}

export function SeasonHeader({
  seasonId,
  seasonNumber,
  seasonName,
  totalEpisodes,
  completedEpisodes,
  projectId,
  accountId,
  episodes,
  audioStatsMap,
  isCollapsed = false,
  onToggleCollapse,
  seasonDescription,
  directionNotes,
}: SeasonHeaderProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showBulkGenerate, setShowBulkGenerate] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [resetTargetStage, setResetTargetStage] = useState<
    'draft' | 'story' | 'screenplay'
  >('draft');
  const [isResettingSeason, setIsResettingSeason] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(seasonName ?? '');
  const inputRef = useRef<HTMLInputElement>(null);
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(directionNotes ?? '');
  const [isSavingNotes, setIsSavingNotes] = useState(false);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const progressPercent =
    totalEpisodes > 0
      ? Math.round((completedEpisodes / totalEpisodes) * 100)
      : 0;

  function handleRename() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === (seasonName ?? '')) {
      setEditName(seasonName ?? '');
      setIsEditing(false);
      return;
    }
    startTransition(async () => {
      try {
        await updateSeasonAction({ seasonId, name: trimmed });
        toast.success('Season renamed');
        setIsEditing(false);
        router.refresh();
      } catch {
        toast.error('Failed to rename season');
      }
    });
  }

  const handleSaveNotes = async () => {
    if (notesValue === (directionNotes ?? '')) return;
    setIsSavingNotes(true);
    try {
      await updateSeasonAction({
        seasonId,
        directionNotes: notesValue || undefined,
      });
    } catch (error) {
      console.error('Failed to save direction notes:', error);
    } finally {
      setIsSavingNotes(false);
    }
  };

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

  const resetStageLabels = {
    draft: 'Draft',
    story: 'Story',
    screenplay: 'Screenplay',
  } as const;
  const resetStageDescriptions = {
    draft: 'story, screenplay, shots, audio, and canon data',
    story: 'screenplay, shots, audio, and canon data',
    screenplay: 'shots and audio data',
  } as const;

  async function handleSeasonReset() {
    setIsResettingSeason(true);
    setShowResetDialog(false);

    const loadingToastId = toast.loading(
      `Resetting ${episodes.length} episodes to ${resetStageLabels[resetTargetStage]}...`,
    );

    try {
      const episodeIds = episodes.map((e) => e.id);
      const result = await bulkResetToStageAction({
        episodeIds,
        accountId,
        targetStage:
          resetTargetStage === 'screenplay' ? 'storyboard' : resetTargetStage,
      });

      toast.dismiss(loadingToastId);

      if (result.success) {
        toast.success(
          `Season ${seasonNumber} reset to ${resetStageLabels[resetTargetStage]} (${result.resetCount} episodes)`,
        );
        router.refresh();
      } else {
        toast.error(`Reset completed with ${result.errors.length} error(s)`);
      }
    } catch (error) {
      toast.dismiss(loadingToastId);
      toast.error(
        error instanceof Error ? error.message : 'Failed to reset season',
      );
    } finally {
      setIsResettingSeason(false);
    }
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
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') {
                    setEditName(seasonName ?? '');
                    setIsEditing(false);
                  }
                }}
                onBlur={handleRename}
                maxLength={255}
                disabled={isPending}
                className="h-7 min-w-[180px] rounded border border-blue-300 bg-white/90 px-2 text-sm font-semibold text-gray-900 outline-none focus:ring-2 focus:ring-blue-500 dark:border-blue-600 dark:bg-gray-800 dark:text-white"
              />
            ) : (
              <h3
                className="group/name flex cursor-pointer items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white"
                onClick={() => setIsEditing(true)}
                title="Click to rename"
              >
                Season {seasonNumber}
                {seasonName && (
                  <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
                    {seasonName}
                  </span>
                )}
                {directionNotes && (
                  <StickyNote className="h-3.5 w-3.5 text-amber-400/60" />
                )}
                <Pencil className="h-3 w-3 text-gray-400 opacity-0 transition-opacity group-hover/name:opacity-100" />
              </h3>
            )}
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {totalEpisodes} {totalEpisodes === 1 ? 'episode' : 'episodes'}
            </p>
            {seasonDescription && (
              <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                {seasonDescription}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Bulk Generate button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowBulkGenerate(true)}
            className="gap-2 border-blue-200 text-blue-600 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-950"
          >
            <Wand2 className="h-4 w-4" />
            <span className="hidden sm:inline">Bulk Generate</span>
          </Button>

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
              <DropdownMenuItem onSelect={() => setIsEditing(true)}>
                <Pencil className="mr-2 h-4 w-4" />
                Rename Season
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setIsEditingNotes(!isEditingNotes)}
              >
                <StickyNote className="mr-2 h-4 w-4" />
                {isEditingNotes
                  ? 'Hide Direction Notes'
                  : 'Edit Direction Notes'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="text-amber-600 focus:text-amber-600 dark:text-amber-500 dark:focus:text-amber-500">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset Season to...
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem
                    onClick={() => {
                      setResetTargetStage('story');
                      setShowResetDialog(true);
                    }}
                  >
                    Reset to Story
                    <span className="text-muted-foreground ml-auto text-xs">
                      Clears screenplay, shots, audio
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setResetTargetStage('screenplay');
                      setShowResetDialog(true);
                    }}
                  >
                    Reset to Screenplay
                    <span className="text-muted-foreground ml-auto text-xs">
                      Clears shots, audio
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-amber-600 focus:text-amber-600 dark:text-amber-500 dark:focus:text-amber-500"
                    onClick={() => {
                      setResetTargetStage('draft');
                      setShowResetDialog(true);
                    }}
                  >
                    Reset to Draft
                    <span className="text-muted-foreground ml-auto text-xs">
                      Clears everything
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuSeparator />
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

      {isEditingNotes && (
        <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-4">
          <div className="mb-2 flex items-center justify-between">
            <label className="text-sm font-medium text-white/80">
              Direction Notes
            </label>
            <span className="text-xs text-white/40">
              {notesValue.length} / 5,000
            </span>
          </div>
          <textarea
            value={notesValue}
            onChange={(e) => setNotesValue(e.target.value)}
            onBlur={handleSaveNotes}
            maxLength={5000}
            rows={3}
            placeholder="e.g., Short-form reels. Fast pacing, strong hooks in first 3 seconds. Each episode under 90 seconds..."
            className="w-full resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 focus:outline-none"
          />
          {isSavingNotes && (
            <p className="mt-1 text-xs text-white/40">Saving...</p>
          )}
        </div>
      )}

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

      {/* Reset Season Confirmation */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset Season {seasonNumber} to{' '}
              {resetStageLabels[resetTargetStage]}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This will reset all <strong>{totalEpisodes} episodes</strong>{' '}
                  in Season {seasonNumber}, clearing their{' '}
                  {resetStageDescriptions[resetTargetStage]}.
                </p>
                <p className="font-medium text-amber-600 dark:text-amber-500">
                  This cannot be undone. All affected episodes will return to{' '}
                  {resetStageLabels[resetTargetStage]} status.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResettingSeason}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSeasonReset}
              disabled={isResettingSeason}
              className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-700"
            >
              {isResettingSeason && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Reset {totalEpisodes} Episodes to{' '}
              {resetStageLabels[resetTargetStage]}
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

      {/* Bulk Generate Modal */}
      <BulkGenerateModal
        open={showBulkGenerate}
        onOpenChange={setShowBulkGenerate}
        seasonId={seasonId}
        seasonNumber={seasonNumber}
        projectId={projectId}
        episodes={episodes}
      />
    </>
  );
}
