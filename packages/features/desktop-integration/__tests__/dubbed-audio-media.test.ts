import { describe, expect, it } from 'vitest';

import { dubbedDialogueAudioPath } from '@kit/storage/upload-paths';

import { fixtureStorage } from '../fixtures/edit-package/build-fixture';
import { FIXTURE_PUBLIC_PREFIX } from '../fixtures/edit-package/seed';
import { resolveMedia } from '../src/server/resolve-media';

/**
 * FILM-2007: the voice worker stores a dubbed line where
 * `dubbedDialogueAudioPath` says (the `audio` bucket, inside the episode's
 * folder), as it stores the source line's own audio. So the edit package
 * signs a dub for its own episode, and a dub stored for another episode is
 * `outside_project`. The path is the worker's own function, not a copy.
 */
const PROJECT = '11111111-2007-4000-8000-000000000001';
const EPISODE = '22222222-2007-4000-8000-000000000002';
const OTHER_EPISODE = '44444444-2007-4000-8000-000000000004';
const LINE = '55555555-2007-4000-8000-000000000005';

const dub = (episodeId: string) =>
  `${FIXTURE_PUBLIC_PREFIX}/audio/${dubbedDialogueAudioPath(episodeId, 'hi', LINE, 1)}`;

describe('a dubbed line in the edit package (FILM-2007)', () => {
  it('is signed for its own episode and refused for another', async () => {
    const own = dub(EPISODE);
    const other = dub(OTHER_EPISODE);
    const resolved = await resolveMedia([own, other], {
      storage: fixtureStorage(new Set()),
      projectId: PROJECT,
      episodeId: EPISODE,
      audioAssetIds: new Set(),
      recordedHashes: {},
      ttlSeconds: 3600,
    });

    expect(own).toContain(`/audio/episodes/${EPISODE}/dubbed/hi/${LINE}_1.mp3`);
    expect(resolved.get(own)).toMatchObject({
      url: expect.stringMatching(/^https:\/\//),
      key: `audio/episodes/${EPISODE}/dubbed/hi/${LINE}_1.mp3`,
    });
    expect(resolved.get(other)).toEqual({
      url: null,
      mediaReason: 'outside_project',
    });
  });
});
