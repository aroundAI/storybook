'use client';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { PublishScreen } from './_components/publish-screen';

export default function PublishPage() {
  const { episode, refetchEpisode, accountSlug, accountId } =
    useEpisodeContext();

  // Unlock condition: Has completed shots (meaning assets are ready for export)
  const hasCompletedShots = Boolean(episode.shots && episode.shots.length > 0);

  if (!hasCompletedShots) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Publishing Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Generate your shots in Visual Studio to unlock exporting and
            publishing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <PublishScreen
        episode={episode}
        refetchEpisode={refetchEpisode}
        accountSlug={accountSlug}
        accountId={accountId}
      />
    </div>
  );
}
