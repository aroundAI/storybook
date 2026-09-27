import { describe, expect, it } from 'vitest';

import {
  EPISODE_VIDEO_SAVE_REFUSAL,
  episodeVideoSaveRefusal,
  episodeVideoUrls,
  ownedEpisodeVideoUpload,
} from '../src/episode-video';
import { publishVideoPath } from '../src/upload-paths';

/**
 * KB-123, save time: a new or changed video must be this episode's own
 * upload; a value the episode already holds is kept. Production serves R2
 * from an r2.dev public domain, so that shape is tested directly.
 */

const E = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const R2 = 'https://pub-0123456789abcdef0123456789abcdef.r2.dev';
const env = { STORAGE_PROVIDER: 'r2', R2_PUBLIC_URL: R2 };
const url = (key: string) => `${R2}/project-assets/${key}`;

const own = url(publishVideoPath(E, 'en', 'mp4', 1));
const othersVideo = url(publishVideoPath(OTHER, 'en', 'mp4', 1));
const legacy = url(`projects/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/shots/s/video/a.mp4`);

describe('ownedEpisodeVideoUpload', () => {
  it('accepts the path every upload uses (publishVideoPath)', () => {
    expect(ownedEpisodeVideoUpload(own, E, env)).toBe(own);
  });

  it("refuses another episode's upload, another host, and a traversal", () => {
    expect(ownedEpisodeVideoUpload(othersVideo, E, env)).toBeNull();
    expect(
      ownedEpisodeVideoUpload(`https://evil.example/project-assets/episodes/${E}/videos/x.mp4`, E, env),
    ).toBeNull();
    expect(
      ownedEpisodeVideoUpload(url(`episodes/${E}/videos/../../${OTHER}/videos/x.mp4`), E, env),
    ).toBeNull();
  });

  it('refuses on Supabase storage by the same rule', () => {
    const sbEnv = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321' };
    const sb = (key: string) =>
      `http://127.0.0.1:54321/storage/v1/object/public/project-assets/${key}`;

    expect(ownedEpisodeVideoUpload(sb(`episodes/${E}/videos/en-1.mp4`), E, sbEnv)).not.toBeNull();
    expect(ownedEpisodeVideoUpload(sb(`episodes/${OTHER}/videos/en-1.mp4`), E, sbEnv)).toBeNull();
  });
});

describe('episodeVideoSaveRefusal', () => {
  const stored = {
    final_video_url: null,
    localized_videos: { hi: legacy },
    shorts_groups: [{ id: 'g1', videos: { en: own } }],
  };

  it('allows a new upload of this episode', () => {
    expect(episodeVideoSaveRefusal({ episodeId: E, stored: {}, next: [own], env })).toBeNull();
  });

  it("refuses another episode's video, as reproduced in KB-123", () => {
    expect(
      episodeVideoSaveRefusal({ episodeId: E, stored: {}, next: [othersVideo], env }),
    ).toBe(EPISODE_VIDEO_SAVE_REFUSAL);
  });

  it('keeps a value the episode already holds, even one outside its folder', () => {
    expect(
      episodeVideoSaveRefusal({ episodeId: E, stored, next: [legacy, own], env }),
    ).toBeNull();
  });

  it('refuses when one of several values is new and foreign', () => {
    expect(
      episodeVideoSaveRefusal({ episodeId: E, stored, next: [legacy, othersVideo], env }),
    ).toBe(EPISODE_VIDEO_SAVE_REFUSAL);
  });

  it('lets an empty value through, which removes a video', () => {
    expect(episodeVideoSaveRefusal({ episodeId: E, stored: {}, next: [''], env })).toBeNull();
  });
});

describe('episodeVideoUrls', () => {
  it('reads all three places, and skips what is not a string', () => {
    expect(
      episodeVideoUrls({
        final_video_url: 'f',
        localized_videos: { en: 'l', hi: { youtube: { url: 'y' } }, es: '' },
        shorts_groups: [{ videos: { en: 's1' } }, 'junk', { videos: null }],
      }),
    ).toEqual(['f', 'l', 's1']);
  });
});
