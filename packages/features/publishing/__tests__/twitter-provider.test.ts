import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { X_API_BASE, X_MEDIA_UPLOAD, xPostUrl } from '@kit/shared/vendors';

import { createTwitterProvider } from '../src/providers/twitter';

/**
 * FILM-1723. The v1.1 chunked upload was retired. `/2/media/upload` is a
 * different protocol, not the old one on a new path: each step has its own
 * endpoint, INIT takes JSON, and the media id comes back as `data.id` rather
 * than `media_id_string`.
 */

const VIDEO_URL = 'https://cdn.example.com/episode.mp4';
const VIDEO_BYTES = 12;
const MEDIA_ID = '1880000000000000001';
const POST_ID = '1990000000000000002';

interface RecordedCall {
  url: string;
  method: string;
  body: BodyInit | null | undefined;
  headers: Record<string, string>;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('TwitterProvider.uploadVideo', () => {
  let calls: RecordedCall[];
  let statusResponses: unknown[];

  beforeEach(() => {
    calls = [];
    statusResponses = [
      { data: { id: MEDIA_ID, processing_info: { state: 'succeeded' } } },
    ];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? 'GET';

        if (url === VIDEO_URL) {
          return method === 'HEAD'
            ? new Response(null, {
                headers: { 'content-length': String(VIDEO_BYTES) },
              })
            : new Response(new Uint8Array(VIDEO_BYTES));
        }

        calls.push({
          url,
          method,
          body: init?.body,
          headers: (init?.headers ?? {}) as Record<string, string>,
        });

        if (url === X_MEDIA_UPLOAD.initialize) {
          return json({ data: { id: MEDIA_ID, media_key: `7_${MEDIA_ID}` } });
        }

        if (url === X_MEDIA_UPLOAD.append(MEDIA_ID)) {
          return json({ data: { expires_at: 1 } });
        }

        if (url === X_MEDIA_UPLOAD.finalize(MEDIA_ID)) {
          return json({
            data: { id: MEDIA_ID, processing_info: { state: 'pending' } },
          });
        }

        if (url === X_MEDIA_UPLOAD.status(MEDIA_ID)) {
          return json(statusResponses.shift());
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
  });

  it('walks initialize, append, finalize, status and then posts', async () => {
    const result = await createTwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'hello',
    });

    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${X_MEDIA_UPLOAD.initialize}`,
      `POST ${X_MEDIA_UPLOAD.append(MEDIA_ID)}`,
      `POST ${X_MEDIA_UPLOAD.finalize(MEDIA_ID)}`,
      `GET ${X_MEDIA_UPLOAD.status(MEDIA_ID)}`,
      `POST ${X_API_BASE}/tweets`,
    ]);

    expect(result).toEqual({
      tweetId: POST_ID,
      status: 'PUBLISHED',
      tweetUrl: xPostUrl(POST_ID),
    });
  });

  it('initialises with a JSON body, not command parameters', async () => {
    await createTwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'hello',
    });

    const init = calls[0]!;

    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      media_type: 'video/mp4',
      total_bytes: VIDEO_BYTES,
      media_category: 'tweet_video',
    });
  });

  it('appends a chunk without the v1.1 command or media_id fields', async () => {
    await createTwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'hello',
    });

    const form = calls[1]!.body as FormData;

    expect([...form.keys()].sort()).toEqual(['media', 'segment_index']);
    expect(form.get('segment_index')).toBe('0');
    expect((form.get('media') as Blob).size).toBe(VIDEO_BYTES);
  });

  it('attaches the id from data.id to the post', async () => {
    await createTwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'hello',
    });

    expect(JSON.parse(calls.at(-1)!.body as string)).toEqual({
      text: 'hello',
      media: { media_ids: [MEDIA_ID] },
    });
  });

  it('reads a processing failure from data.processing_info', async () => {
    statusResponses = [
      {
        data: {
          id: MEDIA_ID,
          processing_info: {
            state: 'failed',
            error: { message: 'unsupported codec' },
          },
        },
      },
    ];

    await expect(
      createTwitterProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'hello',
      }),
    ).rejects.toThrow('unsupported codec');

    expect(calls.map((call) => call.url)).not.toContain(`${X_API_BASE}/tweets`);
  });

  it('names the missing scope when X refuses the upload', async () => {
    vi.mocked(fetch).mockImplementation(async (input) =>
      input.toString() === VIDEO_URL
        ? new Response(null, {
            headers: { 'content-length': String(VIDEO_BYTES) },
          })
        : json({ title: 'Forbidden', status: 403 }, 403),
    );

    await expect(
      createTwitterProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'hello',
      }),
    ).rejects.toThrow('media.write');
  });

  // FILM-714. The character limit is checked before any request is made.
  it('refuses a tweet over 280 characters before sending anything', async () => {
    await expect(
      createTwitterProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'x'.repeat(281),
      }),
    ).rejects.toThrow('Tweet exceeds maximum length of 280 characters');

    expect(calls).toEqual([]);
  });

  it('accepts a tweet of exactly 280 characters', async () => {
    const result = await createTwitterProvider('token').uploadVideo({
      videoPath: VIDEO_URL,
      text: 'x'.repeat(280),
    });

    expect(result.tweetId).toBe(POST_ID);
  });
});
