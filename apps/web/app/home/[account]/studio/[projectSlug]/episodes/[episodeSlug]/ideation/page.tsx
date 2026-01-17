'use client';

import { useEffect, useState } from 'react';

import { useRouter } from 'next/navigation';

import type { ContentStyle } from '@kit/episodes/lib';
import { generateFullStoryAction } from '@kit/episodes/server';
import type { StoryIdea } from '@kit/prompt-engine/schemas';
import { getSupabaseBrowserClient } from '@kit/supabase/browser-client';
import { useLlmJob } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

/** Extended story idea with generation settings */
interface StoryIdeaWithSettings extends StoryIdea {
  targetDuration: number;
  contentStyle: ContentStyle;
}

import { useEpisodeContext } from '../_components/episode-context-provider';
import { IdeationScreen } from './_components/ideation-screen';

export default function IdeationPage() {
  const router = useRouter();
  const {
    episode,
    accountSlug,
    projectSlug,
    projectMetadata,
    refetchEpisode,
    setIsGenerating,
  } = useEpisodeContext();

  // WebSocket for async LLM results (uses shared provider from layout)
  const { status: llmStatus, result: llmResult, error: llmError, trigger: triggerLlm } = useLlmJob<{ storyData: unknown }>(
    'story-generation'
  );

  // Handle async WebSocket result
  useEffect(() => {
    if (llmStatus === 'success' && llmResult) {
      // llmResult is already the result object from message.result (contains {success})
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = llmResult as any;
      if (resultData?.success) {
        toast.success('Story generated successfully');
        setIsGenerating(false);
        refetchEpisode();
        router.push(
          `/home/${accountSlug}/studio/${projectSlug}/episodes/${episode.slug ?? episode.id}/story`,
        );
      }
    } else if (llmStatus === 'error') {
      setIsGenerating(false);
      toast.error(llmError || 'Failed to generate story');
    }
  }, [llmStatus, llmResult, llmError, refetchEpisode, setIsGenerating, router, accountSlug, projectSlug, episode.slug, episode.id]);

  // Extract project defaults for duration and content style
  const defaultDuration =
    (projectMetadata?.defaultEpisodeDuration as number | undefined) ?? 300;
  const defaultContentStyle =
    (projectMetadata?.contentStyle as ContentStyle | undefined) ??
    'dialogue-heavy';

  const handleComplete = async (selection: StoryIdeaWithSettings) => {
    triggerLlm(async () => {

      console.log('[story-actions] start here 1223');

      // Generate the full story using the selected idea
      const result = await generateFullStoryAction({
        episodeId: episode.id,
        version: episode.version,
        title: selection.title,
        logline: selection.logline,
        targetDuration: selection.targetDuration,
        contentStyle: selection.contentStyle,
      });

      console.log('[story-actions] end here 1223');

      // If queued, return queued flag (WebSocket will deliver result)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((result as any)?.queued) {
        toast.info('Generating story in background... This may take a minute.');
        return { queued: true };
      }
      throw new Error('Failed to generate story');
    });
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
