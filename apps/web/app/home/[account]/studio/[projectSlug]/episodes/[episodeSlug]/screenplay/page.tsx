'use client';

import { useRouter } from 'next/navigation';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { ScreenplayScreen } from './_components/screenplay-screen';

export default function ScreenplayPage() {
  const router = useRouter();
  const { episode, accountSlug, projectSlug, refetchEpisode } =
    useEpisodeContext();

  const handleShotListComplete = () => {
    refetchEpisode();
    router.push(
      `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}/visual-studio`,
    );
  };

  // Check if screenplay is unlocked (has screenplay data)
  const hasScreenplay = Boolean(episode.screenplayData?.scenes?.length);

  if (!hasScreenplay) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
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
