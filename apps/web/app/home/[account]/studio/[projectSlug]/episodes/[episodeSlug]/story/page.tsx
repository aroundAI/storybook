'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import type { CanonSettings } from '@kit/episodes';
// import { useActiveGenerationJob } from '@kit/episodes/hooks'; // Removed
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import {
  useEpisodeContext,
  useEpisodeGenerationCheck,
} from '../_components/episode-context-provider';
import { GeneratingState } from '../_components/generating-state';
import { StoryScreen } from './_components/story-screen';

export default function StoryPage() {
  const router = useRouter();
  const { episode, accountSlug, projectSlug, projectMetadata, refetchEpisode } =
    useEpisodeContext();

  // Check if story already has data
  const hasStory = Boolean(episode.storyData?.fullStory);

  // Consolidated generation check
  const { isGenerating } = useEpisodeGenerationCheck({
    episodeId: episode.id,
    jobType: 'story',
    hasData: hasStory,
  });

  // Subscribe to WebSocket for story-generation results
  // This subscriber MUST be at page level so it's active during GeneratingState
  const {
    status: wsStatus,
    result: wsResult,
    error: wsError,
  } = useLlmJob<{ success: boolean }>('story-generation');

  // Handle WebSocket completion - refetch episode data
  useEffect(() => {
    if (wsStatus === 'success' && wsResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = wsResult as any;
      if (resultData?.success) {
        toast.success('Story generated successfully');
      }
      refetchEpisode();
    } else if (wsStatus === 'error') {
      toast.error(wsError || 'Failed to generate story');
      refetchEpisode();
    }
  }, [wsStatus, wsResult, wsError, refetchEpisode]);

  const handleScreenplayComplete = () => {
    refetchEpisode();
    router.push(
      `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}/screenplay`,
    );
  };

  // Show generating state if story is being generated
  if (isGenerating && !hasStory) {
    return (
      <GeneratingState
        title="Story"
        description="Your story is being generated. This usually takes 15-30 seconds."
      />
    );
  }

  // Check if story is unlocked (has story data or status >= 'story')
  const isUnlocked = episode.status !== 'draft' || hasStory;

  if (!isUnlocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="bg-card rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Story Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Complete the ideation step and select a story idea to generate your
            full story.
          </p>
        </div>
      </div>
    );
  }

  // Type-safe extraction of canon settings from projectMetadata
  const isCanonEnabled =
    (projectMetadata as { canon?: CanonSettings } | null)?.canon?.enabled ??
    false;

  return (
    <div className="h-full overflow-y-auto p-8">
      <StoryScreen
        episode={episode}
        onScreenplayComplete={handleScreenplayComplete}
        refetchEpisode={refetchEpisode}
        canonEnabled={isCanonEnabled}
      />
    </div>
  );
}
