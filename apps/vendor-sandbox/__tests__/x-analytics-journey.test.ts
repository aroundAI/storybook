import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Sandbox } from '../src/sandbox';
import { type XTokens, connectedX, refreshX, xSandbox } from './x-helpers';

/**
 * FILM-1727: the app's own X analytics code, unchanged, against the sandbox —
 * a post published through the app's TwitterProvider, then read the way the
 * sync reads it: one billed posts lookup, the playback quartiles inside the
 * 30-day wall, and nothing after it, because the read budget refuses first.
 */

const DAY = 86_400_000;
const T0 = Date.parse('2026-09-28T17:00:00Z');
const START = Date.now();
let skew = 0;
// Four times real time, so the provider's one-second poll outlasts processing.
const tick = () => T0 + (Date.now() - START) * 4 + skew;

let sandbox: Sandbox;
let tokens: XTokens;
let tweetId: string;
let publishedAt: Date;

beforeAll(async () => {
  sandbox = await xSandbox(18043, tick, 1);
  tokens = await connectedX(sandbox);

  const dir = mkdtempSync(join(tmpdir(), 'x-analytics-'));
  const videoFile = join(dir, 'episode.mp4');
  writeFileSync(videoFile, Buffer.alloc(64 * 1024, 7));

  const { TwitterProvider } = await import('@kit/publishing/providers/twitter');
  const result = await new TwitterProvider(tokens.access_token).uploadVideo({
    videoPath: videoFile,
    text: 'The tide clock, a week in.',
  });
  tweetId = result.tweetId;
  publishedAt = new Date(sandbox.social.object('x', tweetId).publishedMs);
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await sandbox.close();
});

function lookups() {
  return sandbox.state.ledger
    .list({ vendor: 'x' })
    .filter((entry) => entry.path === '/2/tweets');
}

describe('X analytics through the app’s own provider', () => {
  it('reads views, likes, replies, reposts, bookmarks and the five quartiles in one call', async () => {
    skew += 3 * DAY;
    tokens = (await refreshX(tokens.refresh_token!)).body;
    const before = lookups().length;

    const { createXAnalyticsProvider } = await import(
      '@kit/content-analytics/providers/twitter'
    );
    const result = await createXAnalyticsProvider(
      tokens.access_token,
    ).getPostAnalytics(tweetId);

    expect(lookups().length - before).toBe(1);
    expect(result.postId).toBe(tweetId);
    expect(result.totals.views).toBeGreaterThan(0);
    expect(result.totals.likes).toBeGreaterThanOrEqual(0);

    const q = result.quartiles!;
    expect(q.started).toBe(result.totals.views);
    expect(q.started).toBeGreaterThanOrEqual(q.quarter);
    expect(q.quarter).toBeGreaterThanOrEqual(q.half);
    expect(q.half).toBeGreaterThanOrEqual(q.threeQuarters);
    expect(q.threeQuarters).toBeGreaterThanOrEqual(q.complete);
  });

  it('the budget allows that read inside the wall', async () => {
    const { decideXRead } = await import(
      '@kit/content-analytics/lib/x-read-budget'
    );

    expect(
      decideXRead({
        enabled: true,
        publishedAt,
        now: new Date(tick()),
        lastReadAt: null,
        readsToday: 0,
      }),
    ).toEqual({ read: true });
  });

  it('past the wall the budget refuses before any call, and X would have no quartiles to give', async () => {
    skew += 28 * DAY;
    tokens = (await refreshX(tokens.refresh_token!)).body;

    const { decideXRead } = await import(
      '@kit/content-analytics/lib/x-read-budget'
    );
    expect(
      decideXRead({
        enabled: true,
        publishedAt,
        now: new Date(tick()),
        lastReadAt: null,
        readsToday: 0,
      }),
    ).toEqual({ read: false, reason: 'outside_window' });

    // What the refused call would have returned, read once here to prove it:
    // public counts still, but no non-public quartiles.
    const { createXAnalyticsProvider } = await import(
      '@kit/content-analytics/providers/twitter'
    );
    const late = await createXAnalyticsProvider(
      tokens.access_token,
    ).getPostAnalytics(tweetId);
    expect(late.quartiles).toBeNull();
    expect(late.totals.views).toBeGreaterThan(0);
  });

  it('never calls the Enterprise analytics endpoints', () => {
    const paths = sandbox.state.ledger.list({ vendor: 'x' }).map((e) => e.path);

    expect(paths).not.toContain('/2/media/analytics');
    expect(paths).not.toContain('/2/tweets/analytics');
  });
});
