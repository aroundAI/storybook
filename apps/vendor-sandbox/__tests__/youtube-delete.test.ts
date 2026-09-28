import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import {
  ALL_YOUTUBE_SCOPES,
  type GoogleTokens,
  connectYouTube,
  googleSandbox,
} from './google-helpers';

/**
 * FILM-1802 / FILM-1806: an unpublish reaches the publish worker's
 * `deleteFromYouTube`, which calls videos.delete. The sandbox answered 404
 * ("does not serve DELETE /youtube/v3/videos"), which the worker reads as
 * already gone, so the delete round trip proved nothing. It now answers as
 * YouTube does: 204 with no body, and the video is gone after.
 */

const T0 = Date.parse('2026-09-20T10:00:00Z');
let sandbox: Sandbox;
let videoFile: string;
let tokens: GoogleTokens;

beforeAll(async () => {
  sandbox = await googleSandbox(18061, () => T0);
  const dir = mkdtempSync(join(tmpdir(), 'yt-delete-'));
  videoFile = join(dir, 'episode.mp4');
  writeFileSync(videoFile, Buffer.alloc(64 * 1024, 7));
  tokens = await connectYouTube(sandbox);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

async function upload() {
  const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
  const result = await new YouTubeProvider(tokens.access_token).uploadVideo({
    videoPath: videoFile,
    title: 'The Letter Under the Floorboards',
    description: 'Episode 1',
    tags: [],
    categoryId: '22',
    privacy: 'public',
    madeForKids: false,
  });
  return result.videoId;
}

async function deleteVideo(accessToken: string, videoId: string) {
  const { deleteFromYouTube } = await import(
    '../../web/lambda/publish-worker/handlers/youtube'
  );
  return deleteFromYouTube(accessToken, videoId);
}

async function listed(videoId: string) {
  const response = await fetch(
    `${sandbox.urls.google}/youtube/v3/videos?part=snippet&id=${videoId}`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );
  return ((await response.json()) as { items: unknown[] }).items.length;
}

describe('videos.delete through the publish worker’s own handler', () => {
  it('deletes the video: 204, and it is gone from videos.list', async () => {
    const videoId = await upload();
    expect(await listed(videoId)).toBe(1);

    await expect(
      deleteVideo(tokens.access_token, videoId),
    ).resolves.toBeUndefined();

    expect(await listed(videoId)).toBe(0);
    expect(sandbox.social.hasObject('youtube', videoId)).toBe(false);
  });

  it('a second delete of the same video is 404 videoNotFound', async () => {
    const videoId = await upload();
    await deleteVideo(tokens.access_token, videoId);

    await expect(
      deleteVideo(tokens.access_token, videoId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('a token without a write scope is refused, and the video stays', async () => {
    const videoId = await upload();
    const readOnly = await connectYouTube(
      sandbox,
      ALL_YOUTUBE_SCOPES.filter((scope) => scope.endsWith('.readonly')),
    );

    await expect(
      deleteVideo(readOnly.access_token, videoId),
    ).rejects.toMatchObject({ status: 403 });
    expect(sandbox.social.hasObject('youtube', videoId)).toBe(true);
  });
});
