import { beforeEach, describe, expect, it, vi } from 'vitest';

import { youtubeProcessingVerdict } from '../src/lib/youtube-processing';

/**
 * KB-205. YouTube accepted two long uploads from unverified channels, then
 * showed "Processing abandoned — Video is too long", while StoryBook left
 * both publishes `published`. The token-refresh cron now asks YouTube what
 * became of each recent upload and marks a failed one failed, with
 * YouTube's reason.
 */

vi.mock('server-only', () => ({}));

const tokens = vi.hoisted(() => ({
  valid: true as boolean,
}));

vi.mock('../src/lib/token-refresh', () => ({
  ensureValidToken: async () =>
    tokens.valid
      ? { valid: true, accessToken: 'yt-token' }
      : { valid: false, error: 'REFRESH_FAILED' },
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({
    warn: () => undefined,
    error: () => undefined,
    info: () => undefined,
  }),
}));

vi.mock('@kit/supabase/server-admin-client', () => ({
  getSupabaseServerAdminClient: () => {
    throw new Error('the test passes its own client');
  },
}));

type Row = {
  id: string;
  platform_connection_id: string;
  platform_content_id: string;
  status: string;
  metadata: Record<string, unknown>;
};

function fakeClient(rows: Row[]) {
  const filters: Array<[string, string, unknown]> = [];
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const client = {
    from: () => {
      let patch: Record<string, unknown> | null = null;
      let id = '';
      const query = {
        select: () => query,
        update: (value: Record<string, unknown>) => {
          patch = value;
          return query;
        },
        eq: (column: string, value: unknown) => {
          if (patch) {
            if (column === 'id') id = value as string;
            if (column === 'status') {
              const row = rows.find((r) => r.id === id)!;
              if (row.status === value) {
                Object.assign(row, patch);
                updates.push({ id, patch });
              }
              return Promise.resolve({ error: null });
            }
          } else {
            filters.push(['eq', column, value]);
          }
          return query;
        },
        gte: (column: string, value: unknown) => {
          filters.push(['gte', column, value]);
          return query;
        },
        not: (column: string, op: string, value: unknown) => {
          filters.push(['not', `${column} ${op}`, value]);
          return query;
        },
        is: (column: string, value: unknown) => {
          filters.push(['is', column, value]);
          return query;
        },
        order: () => query,
        range: async (from: number) => ({
          data: from === 0 ? rows.map((r) => ({ ...r })) : [],
          error: null,
        }),
      };
      return query;
    },
  };

  return { client, filters, updates };
}

const row = (id: string, video: string): Row => ({
  id,
  platform_connection_id: 'conn-yt',
  platform_content_id: video,
  status: 'published',
  metadata: { language: 'en' },
});

describe('youtubeProcessingVerdict', () => {
  it('fails a video rejected for its length, saying to verify the channel', () => {
    expect(
      youtubeProcessingVerdict({
        status: { uploadStatus: 'rejected', rejectionReason: 'length' },
      }),
    ).toEqual({
      state: 'failed',
      reason: 'rejected: length',
      error:
        'YouTube rejected this video: it is longer than the channel may upload (rejectionReason: length). Verify the channel at https://www.youtube.com/verify, then publish it again.',
    });
  });

  it.each([
    [
      { status: { uploadStatus: 'failed', failureReason: 'codec' } },
      'failed: codec',
    ],
    [
      {
        status: { uploadStatus: 'uploaded' },
        processingDetails: {
          processingStatus: 'terminated',
          processingFailureReason: 'other',
        },
      },
      'processing terminated: other',
    ],
    [
      { processingDetails: { processingStatus: 'failed' } },
      'processing failed: unspecified',
    ],
  ])('fails %j', (video, reason) => {
    expect(youtubeProcessingVerdict(video)).toMatchObject({
      state: 'failed',
      reason,
    });
  });

  it('settles a processed video and waits on one still processing', () => {
    expect(
      youtubeProcessingVerdict({
        status: { uploadStatus: 'processed' },
        processingDetails: { processingStatus: 'succeeded' },
      }),
    ).toEqual({ state: 'processed' });
    expect(
      youtubeProcessingVerdict({
        status: { uploadStatus: 'uploaded' },
        processingDetails: { processingStatus: 'processing' },
      }),
    ).toEqual({ state: 'pending' });
  });
});

describe('checkYouTubeProcessing (KB-205)', () => {
  const now = new Date('2026-10-19T06:00:00.000Z');
  let check: typeof import('../src/jobs/check-youtube-processing').checkYouTubeProcessing;

  beforeEach(async () => {
    tokens.valid = true;
    ({ checkYouTubeProcessing: check } = await import(
      '../src/jobs/check-youtube-processing'
    ));
  });

  it('marks an abandoned upload failed with YouTube’s reason, and settles a processed one', async () => {
    const rows = [
      row('too-long', 'vid-long'),
      row('fine', 'vid-ok'),
      row('busy', 'vid-busy'),
      row('gone', 'vid-deleted'),
    ];
    const { client, filters } = fakeClient(rows);
    const asked: string[][] = [];

    const result = await check(now, client as never, async (token, ids) => {
      expect(token).toBe('yt-token');
      asked.push(ids);
      return new Map([
        [
          'vid-long',
          { status: { uploadStatus: 'rejected', rejectionReason: 'length' } },
        ],
        [
          'vid-ok',
          {
            status: { uploadStatus: 'processed' },
            processingDetails: { processingStatus: 'succeeded' },
          },
        ],
        [
          'vid-busy',
          {
            status: { uploadStatus: 'uploaded' },
            processingDetails: { processingStatus: 'processing' },
          },
        ],
      ]);
    });

    // One call for the channel's videos
    expect(asked).toEqual([['vid-long', 'vid-ok', 'vid-busy', 'vid-deleted']]);
    expect(result).toEqual({ checked: 3, failed: 1, processed: 1 });

    expect(rows[0]).toMatchObject({
      status: 'failed',
      metadata: {
        language: 'en',
        errorCode: 'YOUTUBE_PROCESSING_FAILED',
        error: expect.stringContaining('rejectionReason: length'),
        youtube_processing: { state: 'failed', reason: 'rejected: length' },
      },
    });
    expect(rows[1]).toMatchObject({
      status: 'published',
      metadata: { youtube_processing: { state: 'processed' } },
    });
    expect(rows[2]!.metadata).toEqual({ language: 'en' });
    expect(rows[3]!.metadata).toEqual({ language: 'en' });

    // Only recent, unsettled YouTube uploads are read
    expect(filters).toEqual(
      expect.arrayContaining([
        ['eq', 'platform', 'youtube'],
        ['eq', 'status', 'published'],
        ['gte', 'published_at', '2026-10-17T06:00:00.000Z'],
        ['is', 'metadata->youtube_processing', null],
      ]),
    );
  });

  it('asks nothing of a channel whose token is not valid', async () => {
    tokens.valid = false;
    const rows = [row('too-long', 'vid-long')];
    const states = vi.fn();

    const result = await check(now, fakeClient(rows).client as never, states);

    expect(states).not.toHaveBeenCalled();
    expect(result).toEqual({ checked: 0, failed: 0, processed: 0 });
    expect(rows[0]!.status).toBe('published');
  });
});
