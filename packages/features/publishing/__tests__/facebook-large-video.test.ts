import { afterEach, describe, expect, it, vi } from 'vitest';

import { FacebookProvider } from '../src/providers/facebook';

/**
 * KB-209. Meta fetches a `file_url` only up to 1 GB, so a 1.07 GB video
 * from a URL goes through the resumable protocol, in ranged chunks read
 * from that URL, instead of one `file_url` call Meta refuses.
 */

const URL_OF_VIDEO = 'https://cdn.example.com/videos/en-1.mp4';
const CHUNK = 64 * 1024 * 1024;

type Call = { url: string; method: string; body: unknown };

function stubMeta(bytes: number) {
  const calls: Call[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const json = (data: unknown) =>
        new Response(JSON.stringify(data), { status: 200 });

      if (url === URL_OF_VIDEO) {
        calls.push({ url, method, body: null });
        return method === 'HEAD'
          ? new Response(null, {
              status: 200,
              headers: { 'content-length': String(bytes) },
            })
          : new Response(new Uint8Array(4), { status: 206 });
      }

      const body = init?.body;
      const parsed =
        typeof body === 'string' ? JSON.parse(body) : (body as FormData);
      calls.push({ url, method, body: parsed });

      if (parsed instanceof FormData) return json({ id: 'v1' });
      if (parsed.upload_phase === 'start') {
        return json({
          upload_session_id: 's1',
          video_id: 'v1',
          start_offset: 0,
          end_offset: CHUNK,
        });
      }
      if (parsed.upload_phase === 'transfer') {
        const next = Math.min(parsed.start_offset + CHUNK, bytes);
        return json({ start_offset: next, end_offset: next + CHUNK });
      }
      return json({ success: true });
    }),
  );

  return calls;
}

const upload = async (bytes: number) => {
  const calls = stubMeta(bytes);

  await new FacebookProvider('token', 'page').uploadVideo({
    videoPath: URL_OF_VIDEO,
    title: 't',
    description: 'd',
    isReel: false,
    fetchFromUrl: true,
    published: true,
  });

  return calls;
};

const phases = (calls: Call[]) =>
  calls.flatMap(({ body }) =>
    body && !(body instanceof FormData)
      ? [(body as { upload_phase: string }).upload_phase]
      : [],
  );

const sentAsFileUrl = (calls: Call[]) =>
  calls.some(({ body }) => body instanceof FormData);

describe('a Facebook video from a URL over 1 GB (KB-209)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes the resumable path for 1.07 GB, reading ranged chunks from the URL', async () => {
    const calls = await upload(1.07e9);
    const chunks = Math.ceil(1.07e9 / CHUNK);
    const list = phases(calls);

    expect(list[0]).toBe('start');
    expect(list.filter((phase) => phase === 'transfer')).toHaveLength(chunks);
    expect(list.at(-1)).toBe('finish');
    expect(sentAsFileUrl(calls)).toBe(false);
    expect(
      calls.filter(
        ({ url, method }) => url === URL_OF_VIDEO && method === 'GET',
      ),
    ).toHaveLength(chunks);
  });

  it('still lets Meta fetch a file within 1 GB by file_url', async () => {
    const calls = await upload(900e6);

    expect(phases(calls)).toEqual([]);
    expect(sentAsFileUrl(calls)).toBe(true);
  });
});
