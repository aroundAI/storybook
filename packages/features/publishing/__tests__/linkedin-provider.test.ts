import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { vendorUrl } from '@kit/shared/vendors';

import {
  LINKEDIN_CONSTRAINTS,
  createLinkedInProvider,
} from '../src/providers/linkedin';

/**
 * FILM-715. What the provider enforces and how it talks to LinkedIn's REST
 * API: the post-length limit before anything is sent, the two-step video
 * upload (initialise, then post), the text post, and the metrics read.
 * The vendor is stubbed at `fetch`, the way twitter-provider.test.ts does.
 */

const API = `${vendorUrl('linkedin-api')}/v2`;
const VIDEO_URL = 'https://cdn.example.com/episode.mp4';
const UPLOAD_URL = 'https://upload.example.com/put/abc';
const VIDEO_URN = 'urn:li:video:C5F10AQ';
const POST_URN = 'urn:li:share:7000000000000000001';
const AUTHOR = 'urn:li:person:abc123';

interface RecordedCall {
  url: string;
  method: string;
  body: unknown;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('LinkedInProvider', () => {
  let calls: RecordedCall[];
  let respond: (url: string, method: string) => Response | undefined;

  beforeEach(() => {
    calls = [];
    respond = () => undefined;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = input.toString();
        const method = init?.method ?? 'GET';

        if (url === VIDEO_URL) {
          return method === 'HEAD'
            ? new Response(null, { headers: { 'content-length': '12' } })
            : new Response(new Uint8Array(12));
        }

        calls.push({
          url,
          method,
          body:
            typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
        });

        const custom = respond(url, method);
        if (custom) return custom;

        if (url === `${API}/videos?action=initializeUpload`) {
          return json({
            value: {
              video: VIDEO_URN,
              uploadInstructions: [{ uploadUrl: UPLOAD_URL }],
            },
          });
        }
        if (url === UPLOAD_URL) return new Response(null, { status: 200 });
        if (url === `${API}/videos?action=finalizeUpload`)
          return new Response(null, { status: 200 });
        if (url === `${API}/videos/${encodeURIComponent(VIDEO_URN)}`)
          return json({ status: 'AVAILABLE' });
        if (url === `${API}/posts`)
          return json({ id: POST_URN }, 201, { 'x-restli-id': POST_URN });

        return json({ message: `unexpected ${method} ${url}` }, 404);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('post length', () => {
    const provider = createLinkedInProvider('token');
    const limit = LINKEDIN_CONSTRAINTS.post.maxLength;

    it('refuses a video post over the limit before sending anything', async () => {
      await expect(
        provider.uploadVideo({
          videoPath: VIDEO_URL,
          text: 'x'.repeat(limit + 1),
          visibility: 'PUBLIC',
          authorUrn: AUTHOR,
        }),
      ).rejects.toThrow(`maximum length of ${limit} characters`);

      expect(calls).toEqual([]);
    });

    it('refuses a text post over the limit before sending anything', async () => {
      await expect(
        provider.createTextPost({
          text: 'x'.repeat(limit + 1),
          visibility: 'PUBLIC',
          authorUrn: AUTHOR,
        }),
      ).rejects.toThrow(`maximum length of ${limit} characters`);

      expect(calls).toEqual([]);
    });

    it('accepts a post of exactly the limit', async () => {
      const result = await provider.createTextPost({
        text: 'x'.repeat(limit),
        visibility: 'PUBLIC',
        authorUrn: AUTHOR,
      });

      expect(result.postUrn).toBe(POST_URN);
    });
  });

  describe('video upload', () => {
    it('initialises the upload for the author with the file size', async () => {
      await createLinkedInProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'hello',
        visibility: 'PUBLIC',
        authorUrn: AUTHOR,
      });

      expect(calls[0]).toEqual({
        url: `${API}/videos?action=initializeUpload`,
        method: 'POST',
        body: {
          initializeUploadRequest: {
            owner: AUTHOR,
            fileSizeBytes: 12,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        },
      });
    });

    it('walks initialise, upload, finalise, status and then posts', async () => {
      const result = await createLinkedInProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'hello',
        visibility: 'CONNECTIONS',
        authorUrn: AUTHOR,
      });

      expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
        `POST ${API}/videos?action=initializeUpload`,
        `PUT ${UPLOAD_URL}`,
        `POST ${API}/videos?action=finalizeUpload`,
        `GET ${API}/videos/${encodeURIComponent(VIDEO_URN)}`,
        `POST ${API}/posts`,
      ]);
      expect(result).toEqual({
        postUrn: POST_URN,
        status: 'AVAILABLE',
        postUrl: `https://www.linkedin.com/feed/update/${POST_URN}`,
      });
    });

    it('refuses an upload that LinkedIn does not give a URL for', async () => {
      respond = (url) =>
        url === `${API}/videos?action=initializeUpload`
          ? json({ value: { video: VIDEO_URN, uploadInstructions: [] } })
          : undefined;

      await expect(
        createLinkedInProvider('token').uploadVideo({
          videoPath: VIDEO_URL,
          text: 'hello',
          visibility: 'PUBLIC',
          authorUrn: AUTHOR,
        }),
      ).rejects.toThrow('Missing uploadUrl or video URN');
    });
  });

  describe('post creation', () => {
    it('posts the video with the text, visibility and author', async () => {
      await createLinkedInProvider('token').uploadVideo({
        videoPath: VIDEO_URL,
        text: 'A short caption',
        visibility: 'CONNECTIONS',
        authorUrn: AUTHOR,
      });

      const post = calls.find((call) => call.url === `${API}/posts`)!;
      expect(post.body).toMatchObject({
        author: AUTHOR,
        commentary: 'A short caption',
        visibility: 'CONNECTIONS',
        lifecycleState: 'PUBLISHED',
        content: { media: { id: VIDEO_URN } },
      });
    });

    it('takes a text post id from the x-restli-id header', async () => {
      const result = await createLinkedInProvider('token').createTextPost({
        text: 'no video',
        visibility: 'PUBLIC',
        authorUrn: AUTHOR,
      });

      expect(result).toEqual({
        postUrn: POST_URN,
        postUrl: `https://www.linkedin.com/feed/update/${POST_URN}`,
      });
      expect(calls[0]!.body).not.toHaveProperty('content');
    });

    it('reports a refused post with LinkedIn’s reason', async () => {
      respond = (url) =>
        url === `${API}/posts`
          ? new Response('duplicate content', { status: 422 })
          : undefined;

      await expect(
        createLinkedInProvider('token').createTextPost({
          text: 'again',
          visibility: 'PUBLIC',
          authorUrn: AUTHOR,
        }),
      ).rejects.toThrow(
        'LinkedIn text post creation failed: duplicate content',
      );
    });
  });

  describe('post metrics', () => {
    it('reads impressions, likes, comments and shares', async () => {
      respond = (url) =>
        url === `${API}/socialActions/${encodeURIComponent(POST_URN)}`
          ? json({
              totalShareStatistics: {
                impressionCount: 1200,
                likeCount: 48,
                commentCount: 5,
                shareCount: 3,
              },
            })
          : undefined;

      await expect(
        createLinkedInProvider('token').getPostMetrics(POST_URN),
      ).resolves.toEqual({
        impressions: 1200,
        likes: 48,
        comments: 5,
        shares: 3,
      });
    });
  });
});
