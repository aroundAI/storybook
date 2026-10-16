import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import {
  type GoogleTokens,
  connectYouTube,
  googleSandbox,
} from './google-helpers';

/**
 * FILM-1733: the comment sync's YouTube reader, through googleapis, against
 * the sandbox's commentThreads.list. What the unit tests stub is exercised
 * here: the request googleapis builds, the thread and reply shapes the
 * reader takes apart, and a deleted video's 404.
 */

vi.mock('server-only', () => ({}));

const T0 = Date.parse('2026-10-16T10:00:00Z');
let sandbox: Sandbox;
let tokens: GoogleTokens;
let videoId: string;

const reader = () =>
  import(
    '../../../packages/features/content-analytics/src/providers/youtube/youtube-comments'
  );

beforeAll(async () => {
  sandbox = await googleSandbox(18071, () => T0);
  tokens = await connectYouTube(sandbox);

  const dir = mkdtempSync(join(tmpdir(), 'yt-comments-'));
  const videoFile = join(dir, 'episode.mp4');
  writeFileSync(videoFile, Buffer.alloc(64 * 1024, 7));

  const { YouTubeProvider } = await import('@kit/publishing/providers/youtube');
  ({ videoId } = await new YouTubeProvider(tokens.access_token).uploadVideo({
    videoPath: videoFile,
    title: 'The Vault',
    description: 'Episode 1',
    tags: [],
    categoryId: '22',
    privacy: 'public',
    madeForKids: false,
  }));
}, 60_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

describe('reading a video’s comments from YouTube', () => {
  it('reads every thread and the replies YouTube includes, with no commenter', async () => {
    const { fetchYouTubeComments } = await reader();

    const read = await fetchYouTubeComments(tokens.access_token, videoId, {
      maxPages: 50,
    });

    expect(read.complete).toBe(true);
    const top = read.comments.filter((c) => c.parentPlatformCommentId === null);
    const replies = read.comments.filter((c) => c.parentPlatformCommentId);

    expect(top.length).toBeGreaterThanOrEqual(4);
    expect(replies).toHaveLength(2);
    expect(replies[0]!.parentPlatformCommentId).toBe(top[0]!.platformCommentId);
    expect(top[0]).toMatchObject({
      text: expect.any(String),
      likeCount: expect.any(Number),
      replyCount: 1,
      commentedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(Object.keys(top[0]!)).not.toContain('author');

    // Newest first, as order=time asks
    const times = top.map((c) => Date.parse(c.commentedAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('stops at the last read when asked for new comments only', async () => {
    const { fetchYouTubeComments } = await reader();
    const all = await fetchYouTubeComments(tokens.access_token, videoId, {
      maxPages: 50,
    });
    const top = all.comments.filter((c) => c.parentPlatformCommentId === null);
    const since = new Date(top[1]!.commentedAt);

    const read = await fetchYouTubeComments(tokens.access_token, videoId, {
      since,
      maxPages: 5,
    });

    expect(read.complete).toBe(false);
    expect(
      read.comments
        .filter((c) => c.parentPlatformCommentId === null)
        .map((c) => c.platformCommentId),
    ).toEqual([top[0]!.platformCommentId, top[1]!.platformCommentId]);
  });

  it('says a video YouTube no longer has is gone', async () => {
    const { fetchYouTubeComments } = await reader();
    const { CommentVideoGoneError } = await import(
      '../../../packages/features/content-analytics/src/lib/audience-comments/fetched'
    );

    await expect(
      fetchYouTubeComments(tokens.access_token, 'no-such-video', {
        maxPages: 1,
      }),
    ).rejects.toBeInstanceOf(CommentVideoGoneError);
  });
});
