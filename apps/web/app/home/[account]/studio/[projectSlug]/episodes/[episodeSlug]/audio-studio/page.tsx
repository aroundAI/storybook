'use client';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { AudioStudioScreen } from './_components/audio-studio-screen';

export default function AudioStudioPage() {
  const { episode, refetchEpisode } = useEpisodeContext();

  // Check if audio studio is unlocked (has screenplay with dialogue)
  const hasDialogue = Boolean(
    episode.screenplayData?.scenes?.some(
      (scene) => scene.dialogue && scene.dialogue.length > 0,
    ),
  );

  if (!hasDialogue) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="rounded-2xl border border-gray-200 bg-card p-12 text-center shadow-sm">
          <div className="mb-4 text-4xl">🔒</div>
          <h2 className="mb-2 text-xl font-semibold text-gray-900 dark:text-white">
            Audio Studio Locked
          </h2>
          <p className="max-w-md text-gray-500 dark:text-gray-400">
            Complete the screenplay with dialogue lines to unlock the audio
            studio.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden">
      <AudioStudioScreen episode={episode} refetchEpisode={refetchEpisode} />
    </div>
  );
}
