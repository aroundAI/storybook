'use client';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { VisualStudioScreen } from './_components/visual-studio-screen';

export default function VisualStudioPage() {
  const { episode, refetchEpisode } = useEpisodeContext();

  // Check if visual studio is unlocked (has shots or shot list)
  const hasShots = episode.shots.length > 0 || Boolean(episode.shotList);

  if (!hasShots) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
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
