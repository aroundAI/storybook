import { describe, expect, it } from 'vitest';

import { revenueAccessNotes } from '../src/lib/revenue-access';

/**
 * FILM-1726. A revenue figure that reads "Not measured" says why, once per
 * reason: a TikTok channel and a YouTube channel connected before the
 * monetary scope are two different sentences with two different owners.
 */
const youtube = (state: string) => ({
  platform: 'youtube',
  entries: [
    { requirementId: 'youtube.analytics', state: 'authorised' },
    { requirementId: 'youtube.revenue', state },
  ],
});

describe('revenueAccessNotes', () => {
  it('names each reason once, with its owner', () => {
    const notes = revenueAccessNotes([
      youtube('scope_missing'),
      youtube('scope_missing'),
      { platform: 'tiktok', entries: [] },
    ]);

    expect(
      notes.map(({ platform, state, owner }) => [platform, state, owner]),
    ).toEqual([
      ['youtube', 'scope_missing', 'us'],
      ['tiktok', 'unsupported', 'platform'],
    ]);
    expect(notes[0]?.note).toMatch(/Reconnect it/);
    expect(notes[1]?.note).toMatch(/TikTok does not report/);
  });

  it('says nothing for a channel nothing stands in the way of', () => {
    expect(revenueAccessNotes([youtube('authorised')])).toEqual([]);
  });

  it('names the Partner Program to a channel outside it', () => {
    expect(revenueAccessNotes([youtube('account_type_gated')])).toEqual([
      expect.objectContaining({
        state: 'account_type_gated',
        owner: 'creator',
      }),
    ]);
  });

  it('ignores a platform outside the analytics matrix', () => {
    expect(
      revenueAccessNotes([{ platform: 'twitter', entries: null }]),
    ).toEqual([]);
  });
});
