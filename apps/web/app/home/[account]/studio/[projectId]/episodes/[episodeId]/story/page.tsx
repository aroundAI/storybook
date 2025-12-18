'use client';

import { useRouter } from 'next/navigation';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { StoryScreen } from './_components/story-screen';

export default function StoryPage() {
  const router = useRouter();
  const { episode, accountSlug, projectId, refetchEpisode } =
    useEpisodeContext();

  const handleScreenplayComplete = () => {
    refetchEpisode();
    router.push(
      `/home/${accountSlug}/studio/${projectId}/episodes/${episode.id}/screenplay`,
    );
  };

  // Check if story is unlocked (has story data or status >= 'story')
  const isUnlocked =
    episode.status !== 'draft' || Boolean(episode.storyData?.fullStory);

  if (!isUnlocked) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
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

  return (
    <div className="h-full overflow-y-auto p-8">
      <StoryScreen
        episode={episode}
        onScreenplayComplete={handleScreenplayComplete}
        refetchEpisode={refetchEpisode}
      />
    </div>
  );
}
