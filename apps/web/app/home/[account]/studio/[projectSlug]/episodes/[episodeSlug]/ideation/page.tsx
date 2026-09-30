'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import type { CanonSettings, NarrativeThread } from '@kit/episodes';
import type { ContentStyle } from '@kit/episodes/lib';
import {
  generateFullStoryAction,
  getActiveThreadsAction,
} from '@kit/episodes/server';
import { unwrap } from '@kit/next/action-result';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { IdeationScreen } from './_components/ideation-screen';
import { MemoryContextPreview } from './_components/memory-context-preview';
import type { RefinedStoryIdea } from './_components/refine-idea-modal';
import {
  type ThreadCandidate,
  ThreadCandidatesSelector,
} from './_components/thread-candidates-selector';

export default function IdeationPage() {
  const router = useRouter();
  const {
    episode,
    accountSlug,
    projectSlug,
    projectMetadata,
    refetchEpisode,
    setIsGenerating,
  } = useEpisodeContext();

  // Active narrative threads for the thread candidates selector
  const [activeThreads, setActiveThreads] = useState<NarrativeThread[]>([]);
  const [threadCandidates, setThreadCandidates] = useState<ThreadCandidate[]>(
    [],
  );

  // Fetch active narrative threads on mount
  useEffect(() => {
    const fetchThreads = async () => {
      try {
        const projectId = episode.projectId;
        if (!projectId) return;
        const threads = await getActiveThreadsAction({ projectId });
        if (threads) setActiveThreads(threads);
      } catch {
        // Non-fatal: thread selector just won't show
      }
    };
    void fetchThreads();
  }, [episode.projectId]);

  // WebSocket for async LLM results (uses shared provider from layout)
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
    trigger: triggerLlm,
  } = useLlmJob<{ storyData: unknown }>('story-generation');

  // Handle async WebSocket result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // llmResult is already the result object from message.result (contains {success})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = llmResult as any;
      if (resultData?.success) {
        toast.success('Story generated successfully');
        // No refresh before the push: the two race, and a refresh landing second
        // left the user on this page. The destination reads the episode on arrival.
        router.push(
          `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}/story`,
        );
      }
    } else if (llmStatus === 'error') {
      setIsGenerating(false);
      toast.error(llmError || 'Failed to generate story');
    }
  }, [
    llmStatus,
    llmResult,
    llmError,
    refetchEpisode,
    setIsGenerating,
    router,
    accountSlug,
    projectSlug,
    episode.slug,
    episode.id,
  ]);

  // Extract project defaults for duration and content style
  const defaultDuration =
    (projectMetadata?.defaultEpisodeDuration as number | undefined) ?? 300;
  const defaultContentStyle =
    (projectMetadata?.contentStyle as ContentStyle | undefined) ??
    'dialogue-heavy';

  const handleComplete = async (selection: RefinedStoryIdea) => {
    setIsGenerating(true);
    triggerLlm(async () => {
      const result = await unwrap(
        generateFullStoryAction({
          episodeId: episode.id,
          version: episode.version,
          title: selection.title,
          logline: selection.logline,
          targetDuration: selection.targetDuration,
          contentStyle: selection.contentStyle,
          themes: selection.themes.length > 0 ? selection.themes : undefined,
          hook: selection.hook || undefined,
          visualDirection: selection.visualPotential || undefined,
          threadCandidates:
            threadCandidates.length > 0 ? threadCandidates : undefined,
        }),
      );

      if (result && 'queued' in result && result.queued) {
        toast.info('Generating story in background... This may take a minute.');
        return { queued: true };
      }
      setIsGenerating(false);
      throw new Error('Failed to generate story');
    });
  };

  const isCanonEnabled =
    (projectMetadata as { canon?: CanonSettings } | null)?.canon?.enabled ??
    false;

  // Extract character and location IDs from episode metadata
  const characterIds = (episode.metadata?.character_ids as string[]) ?? [];
  const locationIds = (episode.metadata?.location_ids as string[]) ?? [];

  // Get initial premise from episode story data or description
  const initialPremise =
    episode.storyData?.logline ?? episode.description ?? '';

  return (
    <div className="p-8">
      <IdeationScreen
        episodeId={episode.id}
        onComplete={handleComplete}
        initialPremise={initialPremise}
        characterIds={characterIds}
        locationIds={locationIds}
        defaultDuration={defaultDuration}
        defaultContentStyle={defaultContentStyle}
      />

      {/* Thread Candidates — below the ideation form */}
      <div className="mx-auto mt-6 max-w-5xl">
        <ThreadCandidatesSelector
          threads={activeThreads}
          onSelectionChange={setThreadCandidates}
        />
      </div>

      {isCanonEnabled && episode.projectId && (
        <div className="mx-auto mt-6 max-w-5xl">
          <MemoryContextPreview
            projectId={episode.projectId}
            episodeNumber={episode.number ?? 1}
          />
        </div>
      )}
    </div>
  );
}
