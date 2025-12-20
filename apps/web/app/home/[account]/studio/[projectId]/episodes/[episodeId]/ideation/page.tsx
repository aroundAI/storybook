'use client';

import { useRouter } from 'next/navigation';

import type { StoryIdeaWithSettings } from '@kit/episodes/components';
import type { ContentStyle } from '@kit/episodes/lib';
import { generateFullStoryAction } from '@kit/episodes/server';
import { toast } from '@kit/ui/sonner';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { IdeationScreen } from './_components/ideation-screen';

export default function IdeationPage() {
  const router = useRouter();
  const {
    episode,
    accountSlug,
    projectId,
    projectMetadata,
    refetchEpisode,
    setIsGenerating,
  } = useEpisodeContext();

  // Extract project defaults for duration and content style
  const defaultDuration =
    (projectMetadata?.defaultEpisodeDuration as number | undefined) ?? 300;
  const defaultContentStyle =
    (projectMetadata?.contentStyle as ContentStyle | undefined) ??
    'dialogue-heavy';

  const handleComplete = async (selection: StoryIdeaWithSettings) => {
    try {
      // Generate the full story using the selected idea
      const result = await generateFullStoryAction({
        episodeId: episode.id,
        version: episode.version,
        title: selection.title,
        logline: selection.logline,
        targetDuration: selection.targetDuration,
        contentStyle: selection.contentStyle,
      });

      if (result.success) {
        toast.success('Story generated successfully');
        refetchEpisode();
        router.push(
          `/home/${accountSlug}/studio/${projectId}/episodes/${episode.id}/story`,
        );
      }
    } catch (error) {
      // Reset generating state on error
      setIsGenerating(false);
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate story',
      );
    }
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
        defaultDuration={defaultDuration}
        defaultContentStyle={defaultContentStyle}
      />
    </div>
  );
}
