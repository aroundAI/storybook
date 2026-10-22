import type { youtube_v3 } from '@googleapis/youtube';

import type { YouTubeReadiness } from './youtube-staging';

/**
 * KB-214. The YouTube Data API calls a staged upload needs, on a client the
 * caller builds: the web app's provider and the publish worker's handler
 * build theirs differently, and both call these.
 */

type YouTube = youtube_v3.Youtube;

/** Videos by id, 50 a call (1 quota unit each); a video YouTube no longer has is absent */
export async function listVideos(
  youtube: YouTube,
  videoIds: readonly string[],
  parts: string[],
): Promise<Map<string, youtube_v3.Schema$Video>> {
  const videos = new Map<string, youtube_v3.Schema$Video>();

  for (let at = 0; at < videoIds.length; at += 50) {
    const response = await youtube.videos.list({
      part: parts,
      id: videoIds.slice(at, at + 50),
      maxResults: 50,
    });

    for (const item of response.data.items ?? []) {
      if (item.id) videos.set(item.id, item);
    }
  }

  return videos;
}

/** Whether each video is public, processed and in HD */
export async function videoReadiness(
  youtube: YouTube,
  videoIds: readonly string[],
): Promise<Map<string, YouTubeReadiness>> {
  const videos = await listVideos(youtube, videoIds, [
    'status',
    'processingDetails',
    'contentDetails',
  ]);

  return new Map(
    [...videos].map(([id, video]) => [
      id,
      {
        status: video.status,
        processingDetails: video.processingDetails,
        contentDetails: video.contentDetails,
      },
    ]),
  );
}

export type PublishAtResult = 'set' | 'public' | 'gone';

/**
 * Moves a private video's `publishAt`. `videos.update part=status`
 * replaces the whole status, so the video's own audience, AI label,
 * licence and embedding are read first and sent back as they are. A video
 * already public is left public ('public'); one YouTube no longer has is
 * 'gone'. A refusal throws, with YouTube's words.
 */
export async function setVideoPublishAt(
  youtube: YouTube,
  videoId: string,
  publishAt: string,
): Promise<PublishAtResult> {
  const video = (await listVideos(youtube, [videoId], ['status'])).get(videoId);

  if (!video) return 'gone';

  const status = video.status ?? {};

  if (status.privacyStatus === 'public') return 'public';

  try {
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: videoId,
        status: { ...keptStatus(status), privacyStatus: 'private', publishAt },
      },
    });
  } catch (error) {
    throw new Error(
      `YouTube refused to move the video's publish time: ${youtubeErrorText(error)}`,
    );
  }

  return 'set';
}

/**
 * Makes a private video public now (a breaking post once it is in HD),
 * keeping the rest of its status as `setVideoPublishAt` does
 */
export async function setVideoPublic(
  youtube: YouTube,
  videoId: string,
): Promise<'set' | 'public' | 'gone'> {
  const video = (await listVideos(youtube, [videoId], ['status'])).get(videoId);

  if (!video) return 'gone';

  const status = video.status ?? {};

  if (status.privacyStatus === 'public') return 'public';

  try {
    await youtube.videos.update({
      part: ['status'],
      requestBody: {
        id: videoId,
        status: { ...keptStatus(status), privacyStatus: 'public' },
      },
    });
  } catch (error) {
    throw new Error(
      `YouTube refused to make the video public: ${youtubeErrorText(error)}`,
    );
  }

  return 'set';
}

/** The writable status fields the upload set, sent back unchanged */
function keptStatus(status: youtube_v3.Schema$VideoStatus) {
  return {
    selfDeclaredMadeForKids:
      status.selfDeclaredMadeForKids ?? status.madeForKids ?? false,
    ...(status.containsSyntheticMedia != null && {
      containsSyntheticMedia: status.containsSyntheticMedia,
    }),
    ...(status.embeddable != null && { embeddable: status.embeddable }),
    ...(status.license && { license: status.license }),
    ...(status.publicStatsViewable != null && {
      publicStatsViewable: status.publicStatsViewable,
    }),
  };
}

/** Deletes a video; 'gone' when YouTube no longer had it */
export async function deleteVideoIfPresent(
  youtube: YouTube,
  videoId: string,
): Promise<'deleted' | 'gone'> {
  try {
    await youtube.videos.delete({ id: videoId });
    return 'deleted';
  } catch (error) {
    if (statusOf(error) === 404) return 'gone';

    throw new Error(
      `YouTube refused to delete the video: ${youtubeErrorText(error)}`,
    );
  }
}

function statusOf(error: unknown): number | undefined {
  const value = error as {
    status?: number;
    code?: number | string;
    response?: { status?: number };
  };

  return (
    value?.response?.status ??
    value?.status ??
    (typeof value?.code === 'number' ? value.code : undefined)
  );
}

export function youtubeErrorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
