'use client';

import { useRouter } from 'next/navigation';

import type { StoryIdeaWithSettings } from '@kit/episodes/components';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { IdeationScreen } from './_components/ideation-screen';

export default function IdeationPage() {
  const router = useRouter();
  const { episode, accountSlug, projectId, refetchEpisode } =
    useEpisodeContext();

  const handleComplete = (_selection: StoryIdeaWithSettings) => {
    // Store selection in session or pass via URL, then navigate to story
    // For now, just navigate to the story page
    refetchEpisode();
    router.push(
      `/home/${accountSlug}/studio/${projectId}/episodes/${episode.id}/story`,
    );
  };

  // Extract character and location IDs from episode metadata
  const characterIds = (episode.metadata?.character_ids as string[]) ?? [];
  const locationIds = (episode.metadata?.location_ids as string[]) ?? [];

  // Get initial premise from episode story data or description
  const initialPremise =
    episode.storyData?.logline ?? episode.description ?? '';

  return (
    <div className="p-8">
      <IdeationScreen
        episodeId={episode.id}
        onComplete={handleComplete}
        initialPremise={initialPremise}
        characterIds={characterIds}
        locationIds={locationIds}
      />
    </div>
  );
}
