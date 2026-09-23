import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestPresignedUpload,
  uploadWithPresignedUrl,
} from '@kit/storage/client';

/**
 * KB-38: the upload URL is signed for one type and one exact byte count.
 * The browser helper that asks for it must declare the size of exactly the
 * body it then PUTs, and PUT with exactly the headers the route returned.
 * (A second helper, in the Edit Suite, went with it in FILM-607.) A helper that gets either wrong fails in production with a 403
 * from storage.
 */

const PATH =
  'projects/11111111-3800-4000-8000-000000000001/assets/covers/c.png';

const signed = {
  uploadUrl: 'https://storage.test/signed',
  publicUrl: 'https://storage.test/public/c.png',
  expiresIn: 900,
  headers: { 'Content-Type': 'image/png' },
};

const fetchMock = vi.fn();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function presignBody() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

  expect(url).toBe('/api/storage/presign');

  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('@kit/storage/client', () => {
  it('requestPresignedUpload sends the size and returns the headers to PUT with', async () => {
    fetchMock.mockResolvedValueOnce(json(signed));

    const result = await requestPresignedUpload({
      bucket: 'project-assets',
      path: PATH,
      contentType: 'image/png',
      size: 1234,
    });

    expect(presignBody()).toEqual({
      bucket: 'project-assets',
      path: PATH,
      contentType: 'image/png',
      size: 1234,
    });
    expect(result.headers).toEqual({ 'Content-Type': 'image/png' });
  });

  it("requestPresignedUpload throws the route's own refusal", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ error: 'File is 12 MB; images may be at most 10 MB' }, 400),
    );

    await expect(
      requestPresignedUpload({
        bucket: 'project-assets',
        path: PATH,
        contentType: 'image/png',
        size: 12 * 1024 * 1024,
      }),
    ).rejects.toThrow('File is 12 MB; images may be at most 10 MB');
  });

  it('uploadWithPresignedUrl declares file.size and PUTs that file with the returned headers', async () => {
    const file = new File([new Uint8Array(1500)], 'cover.png', {
      type: 'image/png',
    });

    fetchMock
      .mockResolvedValueOnce(
        // X-T: a header the helper could not have made up itself
        json({
          ...signed,
          headers: { 'Content-Type': 'image/png', 'X-T': '1' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    const result = await uploadWithPresignedUrl(file, 'project-assets', PATH);

    expect(presignBody()).toMatchObject({
      contentType: 'image/png',
      size: 1500,
    });

    const [putUrl, putInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(putUrl).toBe(signed.uploadUrl);
    expect(putInit.method).toBe('PUT');
    expect(putInit.body).toBe(file);
    expect(putInit.headers).toEqual({
      'Content-Type': 'image/png',
      'X-T': '1',
    });
    expect(result).toEqual({ url: signed.publicUrl, path: PATH });
  });
});
