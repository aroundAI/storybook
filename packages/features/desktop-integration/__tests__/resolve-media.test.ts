import { describe, expect, it, vi } from 'vitest';

import { fixtureStorage } from '../fixtures/edit-package/build-fixture';
import { FIXTURE_PUBLIC_PREFIX } from '../fixtures/edit-package/seed';
import { resolveMedia } from '../src/server/resolve-media';

/**
 * FILM-2001: R2 signs with the app's own credentials, and a row's media URL
 * is whatever its writer stored. So a URL is signed only when its key lies
 * in this episode's project or episode folder (KB-57's keyInTarget), or is
 * the legacy key of an audio asset the caller read in this project. Every
 * other key is `outside_project`, and the storage is never asked about it.
 */

const PROJECT = '11111111-2001-4000-8000-000000000001';
const EPISODE = '22222222-2001-4000-8000-000000000002';
const OTHER_PROJECT = '33333333-2001-4000-8000-000000000003';
const OTHER_EPISODE = '44444444-2001-4000-8000-000000000004';
const READ_ASSET = '55555555-2001-4000-8000-000000000005';
const UNREAD_ASSET = '66666666-2001-4000-8000-000000000006';

const url = (bucket: string, path: string) =>
  `${FIXTURE_PUBLIC_PREFIX}/${bucket}/${path}`;

async function resolve(urls: string[]) {
  const storage = fixtureStorage(new Set());
  const stat = vi.spyOn(storage, 'stat');
  const sign = vi.spyOn(storage, 'getSignedReadUrl');
  const resolved = await resolveMedia(urls, {
    storage,
    projectId: PROJECT,
    episodeId: EPISODE,
    audioAssetIds: new Set([READ_ASSET]),
    recordedHashes: {},
    ttlSeconds: 3600,
  });

  return { resolved, stat, sign };
}

describe('resolveMedia signs only the episode’s own keys', () => {
  it.each([
    [
      'the project folder',
      url('project-assets', `projects/${PROJECT}/shots/x/video/a.mp4`),
    ],
    [
      'the episode folder',
      url('audio', `episodes/${EPISODE}/dialogue/l_1.mp3`),
    ],
    [
      'the audio bucket’s project folder',
      url('audio', `${PROJECT}/music/m.mp3`),
    ],
    [
      'a read audio asset’s legacy key',
      url('audio-assets', `music/${READ_ASSET}.mp3`),
    ],
  ])('signs a key in %s', async (_where, own) => {
    const { resolved } = await resolve([own]);

    expect(resolved.get(own)!.url).toMatch(/^https:\/\//);
  });

  it.each([
    [
      'another project',
      url('project-assets', `projects/${OTHER_PROJECT}/shots/x/video/a.mp4`),
    ],
    [
      'another episode',
      url('audio', `episodes/${OTHER_EPISODE}/dialogue/l_1.mp3`),
    ],
    [
      'another project in the audio bucket',
      url('audio', `${OTHER_PROJECT}/music/m.mp3`),
    ],
    [
      'an audio asset the caller did not read',
      url('audio-assets', `music/${UNREAD_ASSET}.mp3`),
    ],
    ['a key naming no project', url('project-assets', 'shared/logo.png')],
  ])(
    'refuses a foreign key in %s without touching storage',
    async (_where, foreign) => {
      const { resolved, stat, sign } = await resolve([foreign]);

      expect(resolved.get(foreign)).toEqual({
        url: null,
        mediaReason: 'outside_project',
      });
      expect(stat).not.toHaveBeenCalled();
      expect(sign).not.toHaveBeenCalled();
    },
  );

  it('calls a URL outside StoryBook’s storage not_in_storage', async () => {
    const external = 'https://img.example.com/projects/a.png';
    const { resolved } = await resolve([external]);

    expect(resolved.get(external)).toEqual({
      url: null,
      mediaReason: 'not_in_storage',
    });
  });

  it('a store that cannot be asked is unavailable, never a missing file', async () => {
    const storage = fixtureStorage(new Set());
    storage.stat = async () => {
      throw new Error('socket hang up');
    };
    const own = url('project-assets', `projects/${PROJECT}/assets/x/a.png`);

    const resolved = await resolveMedia([own], {
      storage,
      projectId: PROJECT,
      episodeId: EPISODE,
      audioAssetIds: new Set(),
      recordedHashes: {},
      ttlSeconds: 3600,
    });

    expect(resolved.get(own)).toEqual({
      url: null,
      mediaReason: 'unavailable',
    });
  });
});
