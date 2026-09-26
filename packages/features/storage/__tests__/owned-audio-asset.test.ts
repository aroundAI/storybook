import { describe, expect, it, vi } from 'vitest';

import { ownedAudioAssetLocation } from '../src/storage-key';
import type { StorageAdapter } from '../src/types';

vi.mock('server-only', () => ({}));

/**
 * KB-95: deleting an audio-library asset removes its file with the server's
 * storage credentials. A project writer can rewrite `file_url` on the row
 * (the update policy allows it), so the URL alone must never choose what is
 * deleted: the key has to be one this asset itself would have been stored
 * at, built from its own id and project.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const ASSET = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ASSET = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const storage = {
  getPublicUrl: (bucket: string, path: string) =>
    `https://cdn.example.com/${bucket}/${path}`,
} as unknown as StorageAdapter;

const url = (bucket: string, key: string) =>
  `https://cdn.example.com/${bucket}/${key}`;

const locate = (fileUrl: string | null) =>
  ownedAudioAssetLocation(storage, {
    id: ASSET,
    project_id: PROJECT,
    file_url: fileUrl,
  });

describe('ownedAudioAssetLocation', () => {
  it.each([
    [
      'project-assets',
      `projects/${PROJECT}/assets/audio/1727000000000-1a2b3c4d.mp3`,
    ],
    ['audio-assets', `music/${ASSET}.mp3`],
    ['audio-assets', `sfx/${ASSET}.mp3`],
    ['audio', `${PROJECT}/music/${ASSET}.mp3`],
    ['audio', `${PROJECT}/sfx/${ASSET}.mp3`],
    ['audio', `${PROJECT}/ambient/${ASSET}.mp3`],
  ])('owns %s/%s', (bucket, key) => {
    expect(locate(url(bucket, key))).toEqual({ bucket, key });
  });

  it.each([
    [
      'another project’s upload',
      url(
        'project-assets',
        `projects/${OTHER}/assets/audio/1727000000000-1a2b3c4d.mp3`,
      ),
    ],
    [
      'a non-audio file in the project',
      url('project-assets', `projects/${PROJECT}/assets/intros/en-1.mp4`),
    ],
    [
      'another asset’s generated file',
      url('audio-assets', `music/${OTHER_ASSET}.mp3`),
    ],
    [
      'another project’s generated file',
      url('audio', `${OTHER}/sfx/${ASSET}.mp3`),
    ],
    [
      'a generated key in the wrong bucket',
      url('project-assets', `music/${ASSET}.mp3`),
    ],
    [
      'a traversal',
      url('audio', `${PROJECT}/sfx/../../${OTHER}/sfx/${ASSET}.mp3`),
    ],
    [
      'a foreign host',
      `https://elsewhere.test/audio-assets/music/${ASSET}.mp3`,
    ],
    ['no URL', null],
  ])('does not own %s', (_name, fileUrl) => {
    expect(locate(fileUrl)).toBeNull();
  });

  it('ignores a query string on an owned URL', () => {
    expect(locate(`${url('audio-assets', `sfx/${ASSET}.mp3`)}?v=2`)).toEqual({
      bucket: 'audio-assets',
      key: `sfx/${ASSET}.mp3`,
    });
  });
});
