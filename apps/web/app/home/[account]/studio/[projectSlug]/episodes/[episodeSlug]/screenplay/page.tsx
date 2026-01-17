'use client';

import { useEffect } from 'react';

import { useRouter } from 'next/navigation';

import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import { useActiveGenerationJob } from '@kit/episodes/hooks';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { GeneratingState } from '../_components/generating-state';
import { ScreenplayScreen } from './_components/screenplay-screen';

export default function ScreenplayPage() {
  const router = useRouter();
  const { episode, accountSlug, projectSlug, refetchEpisode } =
    useEpisodeContext();

  // Check if screenplay already has data - skip polling if so
  const hasScreenplay = Boolean(episode.screenplayData?.scenes?.length);

  // Check for active screenplay conversion job (only if no data exists)
  const { isGenerating } = useActiveGenerationJob(
    episode.id,
    'screenplay',
    { enabled: !hasScreenplay }
  );

  // Subscribe to WebSocket for screenplay-conversion results
  // This subscriber MUST be at page level so it's active during GeneratingState
  const { status: wsStatus, result: wsResult, error: wsError } = useLlmJob<{ success: boolean }>(
    'screenplay-conversion'
  );

  // Handle WebSocket completion - refetch episode data
  useEffect(() => {
    if (wsStatus === 'success' && wsResult) {
      console.log('[ScreenplayPage] WebSocket received completion, refetching episode');
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
  if (isGenerating && !hasScreenplay) {
    return (
      <GeneratingState
        title="Screenplay"
        description="Your screenplay is being generated. This usually takes 20-40 seconds."
      />
    );
  }

  // Check if screenplay is unlocked (has screenplay data)
  if (!hasScreenplay) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
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

