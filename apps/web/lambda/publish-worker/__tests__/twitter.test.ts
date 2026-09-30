import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import { X_API_BASE, X_MEDIA_UPLOAD, xPostUrl } from '@kit/shared/vendors';

import { deleteFromTwitter, uploadToTwitter } from '../handlers/twitter';

/**
 * FILM-1723. The lambda walks the upload protocol itself rather than through
 * `TwitterProvider`, so it needs its own proof that it left v1.1 - the
 * provider's test says nothing about this file.
 */

const VIDEO_URL = 'https://cdn.example.com/episode.mp4';
const VIDEO_BYTES = 12;
const MEDIA_ID = '1880000000000000001';
const POST_ID = '1990000000000000002';

const job = {
  videoUrl: VIDEO_URL,
  title: 'Title',
  description: 'Description',
} as PublishJobMessage;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('uploadToTwitter', () => {
  let calls: Array<{ url: string; method: string; body: RequestInit['body'] }>;
  let finalizeState: string;
  let statusStates: string[];

  beforeEach(() => {
    calls = [];
    finalizeState = 'pending';
    statusStates = ['succeeded'];

    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();

        if (url === VIDEO_URL) return new Response(new Uint8Array(VIDEO_BYTES));

        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });

        if (url === X_MEDIA_UPLOAD.initialize) {
          return json({ data: { id: MEDIA_ID } });
        }

        if (url === X_MEDIA_UPLOAD.append(MEDIA_ID)) {
          return json({ data: { expires_at: 1 } });
        }

        if (url === X_MEDIA_UPLOAD.finalize(MEDIA_ID)) {
          return json({
            data: {
              id: MEDIA_ID,
              processing_info: { state: finalizeState, check_after_secs: 0 },
            },
          });
        }

        if (url === X_MEDIA_UPLOAD.status(MEDIA_ID)) {
          return json({
            data: {
              id: MEDIA_ID,
              processing_info: {
                state: statusStates.shift(),
                check_after_secs: 0,
                error: { message: 'unsupported codec' },
              },
            },
          });
        }

        if (url === `${X_API_BASE}/tweets`) {
          return json({ data: { id: POST_ID } });
        }

        return json({ title: 'Not Found', detail: url }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('walks initialize, append, finalize, status and then posts', async () => {
    const result = await uploadToTwitter('token', job);

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${X_MEDIA_UPLOAD.initialize}`,
      `POST ${X_MEDIA_UPLOAD.append(MEDIA_ID)}`,
      `POST ${X_MEDIA_UPLOAD.finalize(MEDIA_ID)}`,
      `GET ${X_MEDIA_UPLOAD.status(MEDIA_ID)}`,
      `POST ${X_API_BASE}/tweets`,
    ]);

    expect(result).toEqual({ contentId: POST_ID, url: xPostUrl(POST_ID) });
  });

  it('sends the v2 bodies: JSON to initialize, no command field on append', async () => {
    await uploadToTwitter('token', job);

    expect(JSON.parse(calls[0]!.body as string)).toEqual({
      media_type: 'video/mp4',
      total_bytes: VIDEO_BYTES,
      media_category: 'tweet_video',
    });

    const form = calls[1]!.body as FormData;

    expect([...form.keys()].sort()).toEqual(['media', 'segment_index']);
    expect(JSON.parse(calls.at(-1)!.body as string).media.media_ids).toEqual([
      MEDIA_ID,
    ]);
  });

  it('skips the status poll when finalize reports the media ready', async () => {
    finalizeState = 'succeeded';

    await uploadToTwitter('token', job);

    expect(calls.map((call) => call.url)).not.toContain(
      X_MEDIA_UPLOAD.status(MEDIA_ID),
    );
  });

  it('does not post when processing fails', async () => {
    statusStates = ['in_progress', 'failed'];

    await expect(uploadToTwitter('token', job)).rejects.toThrow(
      'unsupported codec',
    );

    expect(calls.map((call) => call.url)).not.toContain(`${X_API_BASE}/tweets`);
  });

  it('names the missing scope when X refuses the upload', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input.toString() === VIDEO_URL
        ? new Response(new Uint8Array(VIDEO_BYTES))
        : json({ title: 'Forbidden', status: 403 }, 403),
    );

    await expect(uploadToTwitter('token', job)).rejects.toThrow('media.write');
  });
});

describe('deleteFromTwitter', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends DELETE /2/tweets/:id with the bearer token', async () => {
    const fetchMock = vi.fn(async () => json({ data: { deleted: true } }));

    vi.stubGlobal('fetch', fetchMock);

    await deleteFromTwitter('token', POST_ID);

    expect(fetchMock).toHaveBeenCalledWith(`${X_API_BASE}/tweets/${POST_ID}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token' },
    });
  });

  it("throws with X's status when the request is refused", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ title: 'Forbidden' }, 403)),
    );

    await expect(deleteFromTwitter('token', POST_ID)).rejects.toThrow(
      /Twitter delete failed: 403/,
    );
  });

  it('throws when X answers 200 without deleted: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ data: { deleted: false } })),
    );

    await expect(deleteFromTwitter('token', POST_ID)).rejects.toThrow(
      /was not deleted/,
    );
  });
});
