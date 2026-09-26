import { describe, expect, it } from 'vitest';

import {
  dialogueAudioPath,
  generatedAudioPath,
  keyInTarget,
  storageKeyScope,
  voicePreviewPath,
} from '../src/upload-paths';

/**
 * KB-57: on R2 there are no storage policies, so the only storage-level
 * project check is the one the server runs on the key. A key that names no
 * project cannot be checked at all. Dialogue (`dialogue/<episode>/…`), voice
 * previews (`temp/<user>/…`) and generated library audio (`music/<asset>`,
 * `sfx/<asset>`) were written at such keys.
 */

const PROJECT = '11111111-5700-4000-8000-000000000001';
const EPISODE = '11111111-5700-4000-8000-000000000002';
const OTHER = '11111111-5700-4000-8000-000000000009';
const LINE = '11111111-5700-4000-8000-000000000003';
const USER = '11111111-5700-4000-8000-000000000004';
const ASSET = '11111111-5700-4000-8000-000000000005';
const NOW = 1_790_000_000_000;

describe('every server-written audio key names its project or episode', () => {
  it.each([
    ['dialogue', dialogueAudioPath(EPISODE, LINE, NOW), { episodeId: EPISODE }],
    [
      'voice preview',
      voicePreviewPath(EPISODE, USER, NOW),
      { episodeId: EPISODE },
    ],
    ['sfx', generatedAudioPath(PROJECT, 'sfx', ASSET), { projectId: PROJECT }],
    [
      'music',
      generatedAudioPath(PROJECT, 'music', ASSET),
      { projectId: PROJECT },
    ],
  ])('%s', (_label, key, scope) => {
    expect(storageKeyScope(key)).toEqual(scope);
  });
});

describe('the keys these writers used to build name nothing', () => {
  it.each([
    `dialogue/${EPISODE}/${LINE}_${NOW}.mp3`,
    `temp/${USER}/${NOW}.mp3`,
    `music/${ASSET}.mp3`,
    `sfx/${ASSET}.mp3`,
  ])('%s', (key) => {
    expect(storageKeyScope(key)).toBeNull();
  });
});

describe('storageKeyScope mirrors kit.get_project_id_from_path', () => {
  it.each([
    [`projects/${PROJECT}/assets/covers/c.png`, { projectId: PROJECT }],
    [`episodes/${EPISODE}/thumbnails/en.png`, { episodeId: EPISODE }],
    // The legacy `<projectId>/…` shape, which the SQL also accepts
    [`${PROJECT}/sfx/${ASSET}.mp3`, { projectId: PROJECT }],
    [`PROJECTS/${PROJECT}/x.png`, null],
    [`projects/not-a-uuid/x.png`, null],
    [`projects/${PROJECT}`, { projectId: PROJECT }],
    [`projects/${PROJECT}/../${OTHER}/x.png`, null],
    [`projects//x.png`, null],
    ['', null],
  ])('%s', (key, scope) => {
    expect(storageKeyScope(key)).toEqual(scope);
  });

  it('lower-cases the id, as Postgres does when it casts to uuid', () => {
    expect(storageKeyScope(`projects/${PROJECT.toUpperCase()}/x.png`)).toEqual({
      projectId: PROJECT,
    });
  });
});

describe('keyInTarget', () => {
  it('accepts a key in the target project or episode', () => {
    expect(
      keyInTarget(generatedAudioPath(PROJECT, 'sfx', ASSET), {
        projectId: PROJECT,
      }),
    ).toBe(true);
    expect(
      keyInTarget(dialogueAudioPath(EPISODE, LINE, NOW), {
        episodeId: EPISODE,
      }),
    ).toBe(true);
  });

  it('refuses a key in another project or episode', () => {
    expect(
      keyInTarget(generatedAudioPath(OTHER, 'sfx', ASSET), {
        projectId: PROJECT,
      }),
    ).toBe(false);
    expect(
      keyInTarget(dialogueAudioPath(OTHER, LINE, NOW), { episodeId: EPISODE }),
    ).toBe(false);
  });

  it('refuses a key that names no project, and an empty target', () => {
    expect(keyInTarget(`music/${ASSET}.mp3`, { projectId: PROJECT })).toBe(
      false,
    );
    expect(keyInTarget(generatedAudioPath(PROJECT, 'sfx', ASSET), {})).toBe(
      false,
    );
  });

  it('does not accept an episode key on a project target', () => {
    // Which project an episode belongs to needs the database; a worker
    // holding only a project id cannot tell, so it must not guess.
    expect(
      keyInTarget(dialogueAudioPath(EPISODE, LINE, NOW), {
        projectId: PROJECT,
      }),
    ).toBe(false);
  });
});
