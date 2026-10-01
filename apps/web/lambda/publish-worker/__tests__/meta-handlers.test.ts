import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PublishJobMessage } from '@kit/publishing/lib/job-types';
import { META_GRAPH_VERSION, META_GRAPH_VIDEO_BASE } from '@kit/shared/vendors';

import { deleteFromFacebook, uploadToFacebook } from '../handlers/facebook';
import { uploadToInstagram } from '../handlers/instagram';

/**
 * FILM-1728 §7.3.C. The lambda's Meta handlers are glue over the providers:
 * one implementation of each flow, so a Graph field that changes is fixed in
 * one place. These check the glue — what it passes in, what it hands back,
 * and that a failure the provider reports as a value still fails the job.
 */

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'facebook-api-version': META_GRAPH_VERSION,
    },
  });
}

interface Call {
  method: string;
  url: URL;
  authorization: string | null;
  body: RequestInit['body'];
}

let calls: Call[];
let answer: (call: Call) => Response;

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init: RequestInit = {}) => {
      const call = {
        method: init.method ?? 'GET',
        url: new URL(input),
        authorization: new Headers(init.headers).get('authorization'),
        body: init.body,
      };
      calls.push(call);
      return answer(call);
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const job = {
  videoUrl: 'https://cdn.example.com/episode.mp4',
  title: 'Title',
  description: 'Description',
  metadata: { accountId: '1784', pageId: '1093' },
} as unknown as PublishJobMessage;

describe('uploadToInstagram', () => {
  function graph(status: string) {
    return ({ method, url }: Call) => {
      if (method === 'POST' && url.pathname.endsWith('/1784/media')) {
        return json({ id: 'container-1' });
      }
      if (url.pathname.endsWith('/container-1')) {
        return json({ status_code: status });
      }
      if (url.pathname.endsWith('/1784/media_publish')) {
        return json({ id: 'media-1' });
      }
      if (url.pathname.endsWith('/media-1')) {
        return json({ shortcode: 'Cabc123' });
      }
      return json({ error: { message: url.pathname } }, 404);
    };
  }

  it('publishes through the provider and returns the Reel link, the token only in the header', async () => {
    answer = graph('FINISHED');

    const result = await uploadToInstagram('page-token', job);

    expect(result).toEqual({
      contentId: 'media-1',
      url: 'https://www.instagram.com/reel/Cabc123/',
    });
    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `POST /${META_GRAPH_VERSION}/1784/media`,
      `GET /${META_GRAPH_VERSION}/container-1`,
      `POST /${META_GRAPH_VERSION}/1784/media_publish`,
      `GET /${META_GRAPH_VERSION}/media-1`,
    ]);
    for (const call of calls) {
      expect(call.authorization).toBe('Bearer page-token');
      expect(call.url.searchParams.has('access_token')).toBe(false);
      expect(String(call.body ?? '')).not.toContain('page-token');
    }
    expect(calls[0]!.url.searchParams.get('media_type')).toBe('REELS');
    expect(calls[0]!.url.searchParams.get('share_to_feed')).toBe('true');
  });

  it('fails the job when Meta reports the container failed', async () => {
    answer = graph('ERROR');

    await expect(uploadToInstagram('page-token', job)).rejects.toThrow(
      /processing failed/,
    );
    expect(calls.some((c) => c.url.pathname.endsWith('/media_publish'))).toBe(
      false,
    );
  });
});

describe('uploadToFacebook', () => {
  it('makes one non-resumable upload to graph-video that Meta fetches from the URL', async () => {
    answer = ({ url }) =>
      url.pathname.endsWith('/1093/videos')
        ? json({ id: 'video-9' })
        : json({ error: { message: url.pathname } }, 404);

    const result = await uploadToFacebook('page-token', job);

    expect(result).toEqual({
      contentId: 'video-9',
      url: 'https://www.facebook.com/1093/videos/video-9',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.href).toBe(`${META_GRAPH_VIDEO_BASE}/1093/videos`);
    expect(calls[0]!.authorization).toBe('Bearer page-token');

    const form = calls[0]!.body as FormData;
    expect(form.get('file_url')).toBe(job.videoUrl);
    expect(form.get('published')).toBe('true');
    expect(form.has('access_token')).toBe(false);
  });

  it('deletes by video id with the token in the header', async () => {
    answer = () => json({ success: true });

    await deleteFromFacebook('page-token', 'video-9');

    expect(calls.map((c) => `${c.method} ${c.url.pathname}`)).toEqual([
      `DELETE /${META_GRAPH_VERSION}/video-9`,
    ]);
    expect(calls[0]!.authorization).toBe('Bearer page-token');
  });
});
