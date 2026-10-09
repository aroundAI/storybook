'use client';

import { useQuery } from '@tanstack/react-query';

import { canPublish } from '@kit/episodes/lib/stage-state';
import { getEpisodePublishesAction } from '@kit/publishing/server';
import { LoadingOverlay } from '@kit/ui/loading-overlay';

import { useEpisodeContext } from '../_components/episode-context-provider';
import { AttachVideoPanel } from './_components/attach-video-panel';
import { PublishScreen } from './_components/publish-screen';

export default function PublishPage() {
  const { episode, refetchEpisode, accountSlug, accountId, canTakeDown } =
    useEpisodeContext();

  // The publish screen reads the same query, so this costs no second request
  const {
    data: publishes,
    isLoading,
    refetch: refetchPublishes,
  } = useQuery({
    queryKey: ['episode-publishes', episode.id],
    queryFn: () => getEpisodePublishesAction({ episodeId: episode.id }),
  });

  // FILM-2202: publish opens with a video or a publish made elsewhere,
  // whatever stages the episode went through
  const hasSomethingToPublish = canPublish({
    status: episode.status,
    storyData: episode.storyData,
    screenplayData: episode.screenplayData,
    shotList: episode.shotList,
    shotCount: episode.shots?.length ?? 0,
    audioCueCount: 0,
    finalVideoUrl: episode.finalVideoUrl,
    localizedVideoCount: Object.keys(episode.localizedVideos ?? {}).length,
    externalPublishCount: publishes?.length ?? 0,
  });

  if (isLoading) {
    return <LoadingOverlay fullPage={false} />;
  }

  if (!hasSomethingToPublish) {
    return (
      <div className="h-full overflow-auto">
        <AttachVideoPanel
          episodeId={episode.id}
          onAttached={() => {
            refetchEpisode();
            void refetchPublishes();
          }}
        />
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
        canTakeDown={canTakeDown}
      />
    </div>
  );
}
