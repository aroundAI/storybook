import { describe, expect, it } from 'vitest';

import {
  accountImagePath,
  episodeThumbnailPath,
  isUploadPath,
  projectCoverPath,
  projectIntroPath,
  publishVideoPath,
  shotVideoPath,
} from '../src/upload-paths';

/**
 * KB-39 / KB-53: an uploader built a path in one file and the presign route
 * checked it against a pattern in another, so the intro and avatar uploads
 * were refused on every attempt and nothing noticed. The builders and the
 * route's rules now live in one module, and this binds them: every path an
 * uploader can build is one the route accepts for the bucket it goes to.
 */

const PROJECT = '11111111-3900-4000-8000-000000000001';
const EPISODE = '11111111-3900-4000-8000-000000000002';
const SHOT = '11111111-3900-4000-8000-000000000003';
const ACCOUNT = '11111111-5300-4000-8000-000000000004';
const NOW = 1_790_000_000_000;

describe('every builder produces a path its bucket accepts', () => {
  it.each([
    ['intro', projectIntroPath(PROJECT, 'en', 'video/mp4', NOW)],
    ['intro, webm', projectIntroPath(PROJECT, 'hi', 'video/webm', NOW)],
    ['intro, mov', projectIntroPath(PROJECT, 'es', 'video/quicktime', NOW)],
    ['intro, odd language', projectIntroPath(PROJECT, 'pt BR', 'video/mp4')],
    ['cover', projectCoverPath(PROJECT, 'png', NOW)],
    ['thumbnail', episodeThumbnailPath(EPISODE, 'en', 'jpg', NOW)],
    ['publish video', publishVideoPath(EPISODE, 'en', 'mp4', NOW)],
    ['shot video', shotVideoPath(PROJECT, SHOT, 'mp4', NOW)],
  ])('project-assets: %s', (_label, path) => {
    expect(isUploadPath('project-assets', path)).toBe(true);
    expect(isUploadPath('account_image', path)).toBe(false);
  });

  it.each(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])(
    'account_image: %s',
    (type) => {
      const path = accountImagePath(ACCOUNT, type);

      expect(isUploadPath('account_image', path)).toBe(true);
      expect(isUploadPath('project-assets', path)).toBe(false);
    },
  );
});

describe('the paths the broken uploaders built are still refused', () => {
  it('the pre-KB-39 intro path', () => {
    expect(
      isUploadPath(
        'project-assets',
        `projects/${PROJECT}/intros/en-${NOW}.mp4`,
      ),
    ).toBe(false);
  });

  it('the pre-KB-53 avatar path', () => {
    expect(
      isUploadPath('account_image', `${ACCOUNT}/avatar-${NOW}.png`),
    ).toBe(false);
  });
});

describe('the builders', () => {
  it('put the intro under the project assets folder, typed by MIME', () => {
    expect(projectIntroPath(PROJECT, 'EN', 'video/webm', NOW)).toBe(
      `projects/${PROJECT}/assets/intros/en-${NOW}.webm`,
    );
  });

  it('slug a language that has characters a key may not hold', () => {
    expect(projectIntroPath(PROJECT, 'pt BR/x', 'video/mp4', NOW)).toBe(
      `projects/${PROJECT}/assets/intros/pt-br-x-${NOW}.mp4`,
    );
  });

  it('name the avatar after the account, which the bucket policy requires', () => {
    expect(accountImagePath(ACCOUNT, 'image/jpeg')).toBe(`${ACCOUNT}.jpg`);
    expect(accountImagePath(ACCOUNT, 'IMAGE/PNG')).toBe(`${ACCOUNT}.png`);
  });
});

describe('account_image rule', () => {
  it.each([
    ['a folder', `${ACCOUNT}/${ACCOUNT}.png`],
    ['a non-uuid name', 'avatar.png'],
    ['a non-image extension', `${ACCOUNT}.html`],
    ['no extension', ACCOUNT],
    ['traversal', `../${ACCOUNT}.png`],
  ])('refuses %s', (_label, path) => {
    expect(isUploadPath('account_image', path)).toBe(false);
  });

  it('refuses any bucket it has no rule for', () => {
    expect(isUploadPath('reports', `${ACCOUNT}.png`)).toBe(false);
  });
});
