'use client';

import { Share2 } from 'lucide-react';

import { PublishHub } from '@kit/publishing/components';

import { useEpisodeContext } from '../_components/episode-context-provider';

export default function PublishPage() {
  const { episode, projectId, accountSlug, accountId } = useEpisodeContext();

  // Check if publish is unlocked (has final video)
  const hasFinalVideo = episode.finalVideoUrl !== null;

  if (!hasFinalVideo) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-white p-12 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
            <Share2 className="h-8 w-8 text-gray-400" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Publish Hub Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Export your final video from the Editing Studio to unlock
            multi-platform publishing. Once your video is ready, you can publish
            it to YouTube, TikTok, Instagram, and more.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-6">
      <PublishHub
        episodeId={episode.id}
        projectId={projectId}
        accountSlug={accountSlug}
        accountId={accountId}
        videoUrl={episode.finalVideoUrl!}
        thumbnailUrl={episode.thumbnailUrl ?? undefined}
        defaultTitle={episode.title}
        defaultDescription={episode.description ?? ''}
        duration={episode.durationSeconds ?? 0}
      />
    </div>
  );
}
