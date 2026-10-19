import { afterEach, describe, expect, it, vi } from 'vitest';

import { FacebookProvider } from '../src/providers/facebook';

/**
 * KB-209. Meta fetches a `file_url` only up to 1 GB, so a 1.07 GB video
 * from a URL goes through the resumable protocol: ranged chunks read from
 * that URL, each sent as a binary `video_file_chunk` in multipart/form-data
 * (never base64 in JSON), of the size Meta names between start_offset and
 * end_offset.
 */

const URL_OF_VIDEO = 'https://cdn.example.com/videos/en-1.mp4';
const CHUNK = 128 * 1024 * 1024;

type Call = { url: string; method: string; body: unknown; range?: string };

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
        const range = new Headers(init?.headers).get('range') ?? undefined;
        calls.push({ url, method, body: null, range });

        if (method === 'HEAD') {
          return new Response(null, {
            status: 200,
            headers: { 'content-length': String(bytes) },
          });
        }

        const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range ?? '')!;
        return new Response(new Uint8Array(Number(to) - Number(from) + 1), {
          status: 206,
        });
      }

      const body = init?.body;
      calls.push({ url, method, body });

      if (typeof body === 'string') {
        return json({
          upload_session_id: 's1',
          video_id: 'v1',
          start_offset: 0,
          end_offset: CHUNK,
        });
      }

      const form = body as FormData;
      const phase = form.get('upload_phase');

      if (phase === 'transfer') {
        const chunk = form.get('video_file_chunk');
        const next = Math.min(
          Number(form.get('start_offset')) +
            (chunk instanceof Blob ? chunk.size : 0),
          bytes,
        );
        return json({ start_offset: next, end_offset: next + CHUNK });
      }

      return json(phase === 'finish' ? { success: true } : { id: 'v1' });
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

const forms = (calls: Call[]) =>
  calls.flatMap(({ body }) => (body instanceof FormData ? [body] : []));

const transfers = (calls: Call[]) =>
  forms(calls).filter((form) => form.get('upload_phase') === 'transfer');

describe('a Facebook video from a URL over 1 GB (KB-209)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes the resumable path for 1.07 GB: start, ranged chunks, finish', async () => {
    const calls = await upload(1.07e9);
    const chunks = Math.ceil(1.07e9 / CHUNK);

    expect(
      JSON.parse(
        calls.find(({ body }) => typeof body === 'string')!.body as string,
      ),
    ).toEqual({
      upload_phase: 'start',
      file_size: 1.07e9,
    });
    expect(transfers(calls)).toHaveLength(chunks);
    expect(forms(calls).at(-1)!.get('upload_phase')).toBe('finish');
    expect(forms(calls).at(-1)!.get('upload_session_id')).toBe('s1');
    expect(forms(calls).some((form) => form.has('file_url'))).toBe(false);
    expect(
      calls.filter(
        ({ url, method }) => url === URL_OF_VIDEO && method === 'GET',
      ),
    ).toHaveLength(chunks);
  });

  it('sends each chunk as a binary multipart file of the size Meta named, not base64', async () => {
    const calls = await upload(1.07e9);
    const sent = transfers(calls);
    let offset = 0;

    for (const form of sent) {
      const chunk = form.get('video_file_chunk');
      const expected = Math.min(CHUNK, 1.07e9 - offset);

      expect(chunk).toBeInstanceOf(Blob);
      expect((chunk as Blob).size).toBe(expected);
      expect(form.get('start_offset')).toBe(String(offset));
      expect(form.get('upload_session_id')).toBe('s1');
      offset += expected;
    }

    expect(offset).toBe(1.07e9);
    expect(
      calls.some(
        ({ body }) =>
          typeof body === 'string' && body.includes('video_file_chunk'),
      ),
    ).toBe(false);
  });

  it('still lets Meta fetch a file within 1 GB by file_url', async () => {
    const calls = await upload(900e6);

    expect(transfers(calls)).toEqual([]);
    expect(forms(calls)[0]!.get('file_url')).toBe(URL_OF_VIDEO);
  });
});
