'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

// import { useActiveGenerationJob } from '@kit/episodes/hooks'; // Removed
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import {
  useEpisodeContext,
  useEpisodeGenerationCheck,
} from '../_components/episode-context-provider';
import { GeneratingState } from '../_components/generating-state';
import { ScreenplayScreen } from './_components/screenplay-screen';

export default function ScreenplayPage() {
  const router = useRouter();
  const {
    episode,
    accountSlug,
    projectSlug,
    refetchEpisode,
  } = useEpisodeContext();

  // Check if screenplay already has data
  const hasScreenplay = Boolean(episode.screenplayData?.scenes?.length);

  // Consolidated generation check
  const { isGenerating, isLoading } = useEpisodeGenerationCheck({
    episodeId: episode.id,
    jobType: 'screenplay', // Note: useActiveGenerationJob supports 'screenplay' alias
    hasData: hasScreenplay,
  });

  // Subscribe to WebSocket for screenplay-conversion results
  // This subscriber MUST be at page level so it's active during GeneratingState
  const {
    status: wsStatus,
    result: wsResult,
    error: wsError,
  } = useLlmJob<{ success: boolean }>('screenplay-conversion');

  // Handle WebSocket completion - refetch episode data
  useEffect(() => {
    if (wsStatus === 'success' && wsResult) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = wsResult as any;
      if (resultData?.success) {
        toast.success('Screenplay generated successfully');
      }
      refetchEpisode();
    } else if (wsStatus === 'error') {
      toast.error(wsError || 'Failed to generate screenplay');
      refetchEpisode();
    }
  }, [wsStatus, wsResult, wsError, refetchEpisode]);

  const handleShotListComplete = () => {
    refetchEpisode();
    router.push(
      `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}/visual-studio`,
    );
  };

  // Show generating state if screenplay is being generated
  if ((isGenerating || isLoading) && !hasScreenplay) {
    return (
      <GeneratingState
        title="Screenplay"
        description={
          isLoading
            ? 'Checking status...'
            : 'Your screenplay is being generated. This usually takes 20-40 seconds.'
        }
      />
    );
  }

  // Check if screenplay is unlocked (has screenplay data)
  if (!hasScreenplay) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="bg-card rounded-2xl border border-gray-200 p-12 text-center shadow-sm">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Screenplay Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Complete the story generation and convert it to a screenplay to
            unlock this step.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <ScreenplayScreen
        episode={episode}
        onShotListComplete={handleShotListComplete}
        refetchEpisode={refetchEpisode}
      />
    </div>
  );
}
