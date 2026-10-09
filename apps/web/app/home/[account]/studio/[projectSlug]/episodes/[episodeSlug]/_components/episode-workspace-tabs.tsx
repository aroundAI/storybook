'use client';

import { useState, useTransition } from 'react';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Check, FileText, Scissors, SkipForward, Undo2 } from 'lucide-react';

import {
  SKIPPABLE_STAGES,
  STAGE_KEYS,
  type SkippableStage,
  type StageKey,
  type StageView,
  deriveStageViews,
} from '@kit/episodes/lib/stage-state';
import { setStageSkippedAction } from '@kit/episodes/server/actions';
import type { EpisodeWithShots } from '@kit/episodes/types';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { useEpisodeContext } from './episode-context-provider';
import { ImportScriptDialog } from './import-script-dialog';

/** Each stage's page and label; Video and Publish both open Publish */
const STEPS: Record<StageKey, { id: string; label: string; path: string }> = {
  ideation: { id: 'ideation', label: 'Idea', path: 'ideation' },
  story: { id: 'story', label: 'Story', path: 'story' },
  screenplay: { id: 'screenplay', label: 'Screenplay', path: 'screenplay' },
  shots: { id: 'shot-list', label: 'Shots', path: 'visual-studio' },
  audio: { id: 'audio', label: 'Audio', path: 'audio-studio' },
  video: { id: 'video', label: 'Video', path: 'publish' },
  publish: { id: 'publish', label: 'Publish', path: 'publish' },
};

/** The page the path is on, as a stage */
function activeStage(pathname: string): StageKey | 'edit' {
  if (pathname.endsWith('/story')) return 'story';
  if (pathname.endsWith('/screenplay')) return 'screenplay';
  if (pathname.endsWith('/visual-studio')) return 'shots';
  if (pathname.endsWith('/audio-studio')) return 'audio';
  if (pathname.endsWith('/publish')) return 'publish';
  if (pathname.endsWith('/edit')) return 'edit';
  return 'ideation';
}

/**
 * Every stage, as the shared rule derives it (FILM-2201). The workspace does
 * not load the audio cue count, so audio's state is not shown: a guessed
 * "not started" would be wrong.
 */
function stageViews(episode: EpisodeWithShots): Map<StageKey, StageView> {
  const views = deriveStageViews({
    status: episode.status,
    storyData: episode.storyData,
    screenplayData: episode.screenplayData,
    shotList: episode.shotList,
    shotCount: episode.shots?.length ?? 0,
    audioCueCount: 0,
    finalVideoUrl: episode.finalVideoUrl,
    localizedVideoCount: Object.keys(episode.localizedVideos ?? {}).length,
    skippedStages: episode.skippedStages,
  });

  return new Map(views.map((view) => [view.key, view]));
}

const STATE_LABEL: Record<StageView['state'], string> = {
  done: 'Done',
  empty: 'Not started',
  skipped: 'Skipped',
};

/**
 * FILM-2205: the episode's stages as a progress rail. Every stage is
 * reachable; each shows done, not started or skipped. Under it, a stage
 * with nothing in it says what generating it needs and can be skipped.
 */
export function EpisodeWorkspaceTabs() {
  const pathname = usePathname() ?? '';
  const { episode, accountSlug, projectSlug } = useEpisodeContext();
  const views = stageViews(episode);
  const active = activeStage(pathname);
  const basePath = `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}`;

  return (
    <div className="sticky top-[88px] z-10 px-6 py-2">
      <div className="flex items-center gap-4">
        <nav aria-label="Episode stages" className="flex-1">
          <ol className="flex items-center rounded-xl bg-gray-100/80 p-1 dark:border dark:border-white/5 dark:bg-[#111111]">
            {STAGE_KEYS.map((key, index) => {
              const step = STEPS[key];
              const view = key === 'audio' ? undefined : views.get(key);
              // Video and Publish share a page; the Publish step marks it
              const isActive = active === key;

              return (
                <li key={key} className="flex flex-1 items-center">
                  {index > 0 && (
                    <span
                      aria-hidden
                      className="h-px w-2 flex-shrink-0 bg-gray-300 dark:bg-white/10"
                    />
                  )}
                  <Link
                    href={`${basePath}/${step.path}`}
                    data-test={`episode-tab-${step.id}`}
                    data-stage-state={view?.state}
                    title={
                      view
                        ? `${step.label}: ${STATE_LABEL[view.state]}`
                        : step.label
                    }
                    aria-current={isActive ? 'step' : undefined}
                    className={cn(
                      'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none',
                      isActive
                        ? 'bg-white text-blue-600 shadow-sm dark:bg-[#3B82F6] dark:text-white dark:shadow-[0_0_12px_rgba(59,130,246,0.30)]'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-700 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A] dark:hover:text-white',
                    )}
                  >
                    <StateMark state={view?.state} />
                    <span
                      className={cn(
                        view?.state === 'skipped' && 'line-through opacity-60',
                      )}
                    >
                      {step.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="h-8 w-px bg-gray-300 dark:bg-white/10" />

        <Link
          href={`${basePath}/edit`}
          data-test="episode-tab-edit"
          aria-current={active === 'edit' ? 'page' : undefined}
          className={cn(
            'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium',
            active === 'edit'
              ? 'bg-white text-blue-600 shadow-sm dark:bg-[#3B82F6] dark:text-white'
              : 'text-gray-600 hover:bg-gray-50 dark:text-[#A3A3A3] dark:hover:bg-[#1A1A1A] dark:hover:text-white',
          )}
        >
          <Scissors className="h-3.5 w-3.5" />
          Edit record
        </Link>
      </div>

      {active !== 'edit' && (
        <StageBanner stage={active} view={views.get(active)} />
      )}
    </div>
  );
}

function StateMark({ state }: { state: StageView['state'] | undefined }) {
  if (state === 'done') {
    return (
      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500 text-white">
        <Check aria-hidden className="h-2.5 w-2.5" />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        'h-3.5 w-3.5 rounded-full border',
        state === 'skipped'
          ? 'border-dashed border-gray-400'
          : 'border-gray-400 dark:border-gray-500',
      )}
    />
  );
}

const SKIPPABLE = new Set<StageKey>(SKIPPABLE_STAGES);

/**
 * A stage with nothing in it: what its generator needs, and a way past it.
 * Ideation stores nothing, so it shows only once skipped; a stage with
 * output shows nothing here.
 */
function StageBanner({
  stage,
  view,
}: {
  stage: StageKey;
  view: StageView | undefined;
}) {
  const { episode, refetchEpisode } = useEpisodeContext();
  const [isPending, startTransition] = useTransition();
  const [importOpen, setImportOpen] = useState(false);

  if (!view || !SKIPPABLE.has(stage) || view.state === 'done') return null;
  if (stage === 'ideation' && view.state !== 'skipped') return null;

  const label = STEPS[stage].label.toLowerCase();
  const skipped = view.state === 'skipped';

  function setSkipped(next: boolean) {
    startTransition(async () => {
      try {
        await unwrap(
          setStageSkippedAction({
            episodeId: episode.id,
            version: episode.version,
            stage: stage as SkippableStage,
            skipped: next,
          }),
        );
        refetchEpisode();
      } catch (error) {
        toast.error(refusalMessage(error, 'Could not change the stage'));
      }
    });
  }

  return (
    <div
      className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-xs text-muted-foreground dark:border-white/10"
      data-test="stage-banner"
      data-stage={stage}
    >
      <span>
        {skipped
          ? `${STEPS[stage].label} skipped. You can still add one.`
          : `No ${label} yet.`}
        {!skipped && !view.canGenerate && view.missing.length > 0 && (
          <>
            {' '}
            Generating it needs a {view.missing.join(' and a ')}
            {stage === 'screenplay' ? ', or paste a script instead.' : '.'}
          </>
        )}
      </span>
      <span className="flex items-center gap-2">
        {stage === 'screenplay' && (
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            onClick={() => setImportOpen(true)}
            data-test="stage-banner-paste-script"
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Paste a script
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7"
          disabled={isPending}
          onClick={() => setSkipped(!skipped)}
          data-test={skipped ? 'stage-banner-unskip' : 'stage-banner-skip'}
        >
          {skipped ? (
            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
          ) : (
            <SkipForward className="mr-1.5 h-3.5 w-3.5" />
          )}
          {skipped ? 'Un-skip' : 'Skip this stage'}
        </Button>
      </span>

      {importOpen && (
        <ImportScriptDialog
          episodeId={episode.id}
          version={episode.version}
          open
          onOpenChange={setImportOpen}
          onImported={refetchEpisode}
        />
      )}
    </div>
  );
}
