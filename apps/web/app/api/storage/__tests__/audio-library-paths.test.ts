import { describe, expect, it } from 'vitest';

import { ALLOWED_PROJECT_ASSET_TYPES } from '@kit/assets/upload-validation';
import {
  AUDIO_LIBRARY_UPLOAD_TYPES,
  audioLibraryUploadPath,
  audioLibraryUploadType,
  isAudioLibraryPath,
  isUploadPath,
} from '@kit/storage/upload-paths';

/**
 * KB-73: the audio library uploads straight to storage through the presign
 * route, into `project-assets`, instead of sending the file as base64 in a
 * server-action body. These bind the three places that must agree: the path
 * the dialog builds, the path the presign route will sign, and the path the
 * save action will accept for that project. And the types it declares must be
 * ones the route and the bucket already take, so KB-28's list is not widened.
 */

const PROJECT = '11111111-7300-4000-8000-000000000001';
const OTHER = '11111111-7300-4000-8000-000000000002';
const NOW = 1_790_000_000_000;

describe('audioLibraryUploadPath', () => {
  it.each(AUDIO_LIBRARY_UPLOAD_TYPES)(
    '%s: the presign route signs it and the action accepts it for its project only',
    (type) => {
      const path = audioLibraryUploadPath(PROJECT, type, NOW);

      expect(path).toMatch(
        new RegExp(`^projects/${PROJECT}/assets/audio/${NOW}-[0-9a-f]{8}\\.`),
      );
      expect(isUploadPath('project-assets', path)).toBe(true);
      expect(isAudioLibraryPath(PROJECT, path)).toBe(true);
      expect(isAudioLibraryPath(OTHER, path)).toBe(false);
    },
  );

  it('carries no user text, and two uploads in the same millisecond differ', () => {
    const a = audioLibraryUploadPath(PROJECT, 'audio/mpeg', NOW);
    const b = audioLibraryUploadPath(PROJECT, 'audio/mpeg', NOW);

    expect(a).not.toBe(b);
  });

  it('declares only types the project-assets bucket already takes', () => {
    for (const type of AUDIO_LIBRARY_UPLOAD_TYPES) {
      expect(ALLOWED_PROJECT_ASSET_TYPES).toContain(type);
    }
  });
});

describe('audioLibraryUploadType', () => {
  it.each([
    ['audio/mpeg', 'a.mp3', 'audio/mpeg'],
    ['audio/mp3', 'a.mp3', 'audio/mpeg'],
    ['audio/wav', 'a.wav', 'audio/wav'],
    ['audio/x-wav', 'a.wav', 'audio/wav'],
    ['audio/wave', 'a.wav', 'audio/wav'],
    ['audio/mp4', 'a.m4a', 'audio/mp4'],
    ['audio/x-m4a', 'a.m4a', 'audio/mp4'],
    ['AUDIO/X-M4A', 'a.m4a', 'audio/mp4'],
    ['', 'a.M4A', 'audio/mp4'],
    ['', 'a.mp3', 'audio/mpeg'],
  ])('%s (%s) → %s', (type, name, expected) => {
    expect(audioLibraryUploadType(type, name)).toBe(expected);
  });

  it.each([
    ['text/html', 'a.mp3'],
    ['audio/ogg', 'a.ogg'],
    ['video/mp4', 'a.m4a'],
    ['', 'a.html'],
    ['', 'noextension'],
  ])('refuses %s (%s)', (type, name) => {
    expect(audioLibraryUploadType(type, name)).toBeNull();
  });
});

describe('isAudioLibraryPath refuses anything but its own folder', () => {
  const good = audioLibraryUploadPath(PROJECT, 'audio/mpeg', NOW);
  const name = good.split('/').pop()!;

  it.each([
    ['another project', `projects/${OTHER}/assets/audio/${name}`],
    ['another folder', `projects/${PROJECT}/assets/covers/${name}`],
    ['the legacy key', `music/${NOW}-theme.mp3`],
    ['traversal', `projects/${PROJECT}/assets/audio/../covers/${name}`],
    ['a user file name', `projects/${PROJECT}/assets/audio/${NOW}-my song.mp3`],
    ['another extension', good.replace(/\.mp3$/, '.html')],
    ['a prefix', `x/${good}`],
  ])('%s', (_label, path) => {
    expect(isAudioLibraryPath(PROJECT, path)).toBe(false);
  });

  it('a project id that is not a uuid matches nothing', () => {
    expect(isAudioLibraryPath('.*', good)).toBe(false);
  });
});
