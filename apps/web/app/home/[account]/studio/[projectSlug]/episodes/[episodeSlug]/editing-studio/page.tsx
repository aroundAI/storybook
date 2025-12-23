'use client';

import { Scissors } from 'lucide-react';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { EditingStudioScreen } from './_components/editing-studio-screen';

export default function EditingStudioPage() {
  const { episode, refetchEpisode, projectId, accountSlug } =
    useEpisodeContext();

  // Check if editing studio is unlocked (has shots with completed videos)
  const completedShots = episode.shots?.filter(
    (shot) => shot.status === 'completed' && shot.videoUrl,
  );
  const hasCompletedShots = completedShots && completedShots.length > 0;

  if (!hasCompletedShots) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
            <Scissors className="h-8 w-8 text-gray-400" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Editing Studio Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Upload videos to your shots in the Visual Studio to unlock the
            editing studio. Once you have completed shot videos, you can compile
            them into a final episode here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <EditingStudioScreen
        episode={episode}
        projectId={projectId}
        accountSlug={accountSlug}
        refetchEpisode={refetchEpisode}
      />
    </div>
  );
}
