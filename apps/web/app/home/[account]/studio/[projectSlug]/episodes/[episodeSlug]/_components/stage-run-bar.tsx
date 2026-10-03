'use client';

import { useState, useTransition } from 'react';

import { usePathname } from 'next/navigation';

import { useQuery } from '@tanstack/react-query';
import { History, Loader2 } from 'lucide-react';

import { ExternalRunBanner, OriginBadge } from '@kit/episodes/components';
import { latestStageOrigin } from '@kit/episodes/lib/generation-origin';
import {
  STUDIO_PAGE_STAGES,
  type StudioPage,
  latestStageRevision,
  studioPageFromPath,
} from '@kit/episodes/lib/stage-runs';
import { restoreRevisionAction } from '@kit/episodes/server/run-actions';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { useSupabase } from '@kit/supabase/hooks/use-supabase';
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
import { toast } from '@kit/ui/sonner';

import { useEpisodeContext } from './episode-context-provider';

/**
 * The studio page this route shows, and the open external runs that block
 * its Generate buttons (FILM-1910). Every Generate button on the story,
 * screenplay, visual studio and audio studio pages is disabled while
 * `locked` is true.
 */
export function useStageRunLock() {
  const page = studioPageFromPath(usePathname());
  const { externalRuns } = useEpisodeContext();

  const blocks: readonly string[] = page ? STUDIO_PAGE_STAGES[page].blocks : [];
  const runs = externalRuns.filter((run) => blocks.includes(run.stage));

  return { page, runs, locked: runs.length > 0 };
}

/** Banner, author and "Restore previous version" for the current stage. */
export function StageRunBar() {
  const { page, runs, locked } = useStageRunLock();
  const { episode } = useEpisodeContext();

  if (!page) return null;

  // Story and screenplay live on the episode row; shots and dialogue lines
  // carry their own badge on each item
  const origin =
    page === 'story' || page === 'screenplay'
      ? latestStageOrigin(
          episode.generationOrigin,
          STUDIO_PAGE_STAGES[page].stages,
        )
      : null;

  return (
    <div data-test="stage-run-bar">
      <ExternalRunBanner runs={runs} />
      <div className="flex min-h-0 items-center gap-3 px-6 empty:hidden">
        {origin && (
          <span className="flex items-center gap-2 py-2 text-xs text-gray-500 dark:text-gray-400">
            Written by
            <OriginBadge origin={origin} />
          </span>
        )}
        <RestorePreviousVersion page={page} disabled={locked} />
      </div>
    </div>
  );
}

function RestorePreviousVersion({
  page,
  disabled,
}: {
  page: StudioPage;
  disabled: boolean;
}) {
  const client = useSupabase();
  const { episode, refetchEpisode } = useEpisodeContext();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  // episodes.version moves on every commit and restore, so the newest
  // revision is re-read whenever the episode changes
  const { data: revision } = useQuery({
    queryKey: ['stage-revision', episode.id, page, episode.version],
    queryFn: () =>
      latestStageRevision(client, episode.id, STUDIO_PAGE_STAGES[page].stages),
  });

  if (!revision) return null;

  const restore = () => {
    startTransition(async () => {
      try {
        await unwrap(restoreRevisionAction({ episodeId: episode.id, page }));
        toast.success('Previous version restored');
        setOpen(false);
        refetchEpisode();
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Could not restore the previous version'),
        );
      }
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="ml-auto gap-1.5 text-xs"
        data-test="restore-previous-version"
        disabled={disabled || isPending}
        title={
          disabled
            ? 'Paused while an AI client is writing this stage'
            : undefined
        }
        onClick={() => setOpen(true)}
      >
        <History className="h-3.5 w-3.5" />
        Restore previous version
      </Button>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restore the previous version?</AlertDialogTitle>
          <AlertDialogDescription>
            This puts back what was here before the last change, saved{' '}
            {new Date(revision.createdAt).toLocaleString()}. What is here now is
            kept, so restoring again brings it back.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>
            Keep current
          </AlertDialogCancel>
          <AlertDialogAction
            data-test="restore-previous-version-confirm"
            disabled={isPending}
            onClick={(event) => {
              event.preventDefault();
              restore();
            }}
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Restore
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
