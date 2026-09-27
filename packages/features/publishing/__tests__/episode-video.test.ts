import { describe, expect, it } from 'vitest';

import {
  PUBLISH_NOW_PRECEDENCE,
  SCHEDULED_JOB_PRECEDENCE,
  SCHEDULED_LAMBDA_PRECEDENCE,
  resolveEpisodeVideo,
} from '../src/lib/episode-video';

/**
 * KB-123: one resolver replaced three copies. It must publish exactly what
 * each copy did. The three copies are kept below, verbatim in their logic,
 * as oracles, and compared with the resolver over every combination of the
 * inputs they read.
 */

type Groups = Array<{ id: string; videos: Record<string, string> }>;

interface Episode {
  final_video_url: string | null;
  localized_videos: Record<string, string> | null;
  shorts_groups: Groups | null;
}

/** apps/web/lambda/scheduled-publish/index.ts `resolveVideoUrl`, before KB-123 */
function oldLambda(
  episode: Episode,
  lang: string,
  isShort: boolean,
  shortsGroupId: string | undefined,
): string | null {
  const localizedVideos = episode.localized_videos ?? {};
  const shortsGroups = episode.shorts_groups ?? [];

  if (isShort) {
    if (!shortsGroupId) return null;

    for (const group of shortsGroups) {
      if (group?.id === shortsGroupId) {
        if (group.videos?.[lang]) return group.videos[lang]!;
        return null;
      }
    }

    return null;
  }

  if (localizedVideos[lang]) return localizedVideos[lang]!;
  if (episode.final_video_url) return episode.final_video_url;
  return null;
}

/** packages/features/publishing/src/jobs/process-scheduled-publishes.ts, before KB-123 */
function oldJob(
  episode: Episode,
  lang: string,
  isShort: boolean,
  shortsGroupId: string | undefined,
): string | null {
  const localizedVideos = episode.localized_videos ?? {};
  const shortsGroups = episode.shorts_groups ?? [];

  const getShortsVideoUrl = (language: string): string | null => {
    for (let i = 0; i < shortsGroups.length; i++) {
      const group = shortsGroups[i];
      if (!group) continue;
      if (shortsGroupId && group.id !== shortsGroupId) continue;
      if (group.videos && group.videos[language]) return group.videos[language]!;
    }
    return null;
  };

  if (isShort) {
    return (
      getShortsVideoUrl(lang) ??
      localizedVideos[lang] ??
      episode.final_video_url ??
      null
    );
  }

  return localizedVideos[lang] ?? episode.final_video_url ?? null;
}

/** packages/features/publishing/src/server/publish-actions.ts publishToAll, before KB-123 */
function oldPublishNow(
  episode: Episode,
  lang: string,
  isShortsPreferred: boolean,
): { url: string | null; contentType: 'short' | 'full' } {
  const localizedVideos = episode.localized_videos ?? {};
  const shortsGroups = episode.shorts_groups ?? [];

  const getShortsVideoUrl = (language: string): string | null => {
    for (const group of shortsGroups) {
      if (group.videos && group.videos[language]) return group.videos[language]!;
    }
    return null;
  };
  const shortsVideoUrl = getShortsVideoUrl(lang);

  const url = isShortsPreferred
    ? (shortsVideoUrl ?? localizedVideos[lang] ?? episode.final_video_url ?? null)
    : (localizedVideos[lang] ?? shortsVideoUrl ?? episode.final_video_url ?? null);

  return {
    url,
    contentType: shortsVideoUrl && isShortsPreferred ? 'short' : 'full',
  };
}

// Every combination of what the three copies read
const FINALS = [null, 'final.mp4'];
const LOCALIZED: Array<Record<string, string> | null> = [
  null,
  {},
  { en: 'loc-en.mp4' },
  { hi: 'loc-hi.mp4' },
];
const GROUPS: Array<Groups | null> = [
  null,
  [],
  [{ id: 'g1', videos: { en: 'g1-en.mp4' } }],
  [
    { id: 'g1', videos: { hi: 'g1-hi.mp4' } },
    { id: 'g2', videos: { en: 'g2-en.mp4' } },
  ],
  [
    { id: 'g1', videos: { en: 'g1-en.mp4' } },
    { id: 'g2', videos: { en: 'g2-en.mp4' } },
  ],
];
const LANGS = ['en', 'hi'];
const GROUP_IDS = [undefined, 'g1', 'g2', 'missing'];

const episodes: Episode[] = FINALS.flatMap((final_video_url) =>
  LOCALIZED.flatMap((localized_videos) =>
    GROUPS.map((shorts_groups) => ({
      final_video_url,
      localized_videos,
      shorts_groups,
    })),
  ),
);

describe('resolveEpisodeVideo reproduces each old copy', () => {
  it('the scheduled Lambda', () => {
    let cases = 0;

    for (const episode of episodes)
      for (const lang of LANGS)
        for (const short of [false, true])
          for (const shortsGroupId of GROUP_IDS) {
            const got = resolveEpisodeVideo(episode, {
              language: lang,
              short,
              shortsGroupId,
              ...SCHEDULED_LAMBDA_PRECEDENCE,
            });
            expect(got?.url ?? null).toBe(
              oldLambda(episode, lang, short, shortsGroupId),
            );
            cases++;
          }

    expect(cases).toBe(640);
  });

  it('the in-app scheduled job', () => {
    for (const episode of episodes)
      for (const lang of LANGS)
        for (const short of [false, true])
          for (const shortsGroupId of GROUP_IDS) {
            const got = resolveEpisodeVideo(episode, {
              language: lang,
              short,
              shortsGroupId,
              ...SCHEDULED_JOB_PRECEDENCE,
            });
            expect(got?.url ?? null).toBe(
              oldJob(episode, lang, short, shortsGroupId),
            );
          }
  });

  it('publish-now, including the content type it records', () => {
    for (const episode of episodes)
      for (const lang of LANGS)
        for (const short of [false, true]) {
          const got = resolveEpisodeVideo(episode, {
            language: lang,
            short,
            ...PUBLISH_NOW_PRECEDENCE,
          });
          const old = oldPublishNow(episode, lang, short);

          expect(got?.url ?? null).toBe(old.url);
          expect(got?.from === 'short' && short ? 'short' : 'full').toBe(
            old.contentType,
          );
        }
  });
});

describe('what the resolver does not treat as a video', () => {
  it('skips an empty string, where two copies returned it and then failed', () => {
    expect(
      resolveEpisodeVideo(
        { final_video_url: 'final.mp4', localized_videos: { en: '' } },
        { language: 'en', short: false, ...SCHEDULED_JOB_PRECEDENCE },
      ),
    ).toEqual({ url: 'final.mp4', from: 'final' });
  });

  it('skips an object, which public sharing writes into localized_videos', () => {
    expect(
      resolveEpisodeVideo(
        {
          final_video_url: 'final.mp4',
          localized_videos: { en: { youtube: { url: 'https://youtu.be/x' } } },
        },
        { language: 'en', short: false, ...PUBLISH_NOW_PRECEDENCE },
      ),
    ).toEqual({ url: 'final.mp4', from: 'final' });
  });
});
