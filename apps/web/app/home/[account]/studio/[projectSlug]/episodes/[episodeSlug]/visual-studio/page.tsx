'use client';

import { useEffect } from 'react';

import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import { useActiveGenerationJob } from '@kit/episodes/hooks';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { GeneratingState } from '../_components/generating-state';
import { VisualStudioScreen } from './_components/visual-studio-screen';

export default function VisualStudioPage() {
  const { episode, refetchEpisode } = useEpisodeContext();

  // Check if visual studio already has data - skip polling if so
  const hasShots = episode.shots.length > 0 || Boolean(episode.shotList);

  // Check for active shot generation job (only if no data exists)
  const { isGenerating } = useActiveGenerationJob(
    episode.id,
    'shot_list',
    { enabled: !hasShots } // Don't poll if data already exists
  );

  // Subscribe to WebSocket for shot-generation results
  // This subscriber MUST be at page level so it's active during GeneratingState
  const { status: wsStatus, result: wsResult, error: wsError } = useLlmJob<{ success: boolean }>(
    'shot-generation'
  );

  // Handle WebSocket completion - refetch episode data
  useEffect(() => {
    if (wsStatus === 'success' && wsResult) {
      console.log('[VisualStudioPage] WebSocket received completion, refetching episode');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = wsResult as any;
      if (resultData?.success) {
        toast.success('Shot list generated successfully');
      }
      refetchEpisode();
    } else if (wsStatus === 'error') {
      toast.error(wsError || 'Failed to generate shot list');
      refetchEpisode(); // Still refetch to update state
    }
  }, [wsStatus, wsResult, wsError, refetchEpisode]);

  // Show generating state if shots are being generated
  if (isGenerating && !hasShots) {
    return (
      <GeneratingState
        title="Shot List"
        description="Your shots are being generated. This usually takes 30-60 seconds."
      />
    );
  }

  // Check if visual studio is unlocked (has shots or shot list)
  if (!hasShots) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Visual Studio Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Complete the screenplay approval and generate a shot list to unlock
            the visual studio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <VisualStudioScreen episode={episode} refetchEpisode={refetchEpisode} />
    </div>
  );
}

