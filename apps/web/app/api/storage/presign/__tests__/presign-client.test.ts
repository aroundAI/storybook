import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  requestPresignedUpload,
  uploadWithPresignedUrl,
} from '@kit/storage/client';

// Not a package export: the export dialog is its only caller.
import { uploadToR2Presigned } from '../../../../../../../packages/features/edit-suite/src/lib/presigned-upload';

/**
 * KB-38: the upload URL is signed for one type and one exact byte count.
 * The two browser helpers that ask for it must declare the size of exactly
 * the body they then PUT, and PUT with exactly the headers the route
 * returned. A helper that gets either wrong fails in production with a 403
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

describe('@kit/edit-suite/presigned-upload', () => {
  class FakeXhr {
    static last: FakeXhr;
    headers: Record<string, string> = {};
    method = '';
    url = '';
    sent: unknown;
    status = 200;
    upload = { addEventListener: vi.fn() };
    private listeners: Record<string, () => void> = {};

    constructor() {
      FakeXhr.last = this;
    }

    addEventListener(event: string, listener: () => void) {
      this.listeners[event] = listener;
    }

    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }

    send(body: unknown) {
      this.sent = body;
      queueMicrotask(() => this.listeners.load?.());
    }
  }

  it('declares blob.size and PUTs that blob with the returned headers', async () => {
    vi.stubGlobal('XMLHttpRequest', FakeXhr);

    const blob = new Blob([new Uint8Array(4321)], { type: 'video/mp4' });

    // A header the helper could not have made up, so the test can tell
    // "sent what the route returned" from "sent its own Content-Type".
    const returned = { 'Content-Type': 'video/mp4', 'X-Signed-For': 'kb-38' };

    fetchMock.mockResolvedValueOnce(json({ ...signed, headers: returned }));

    const result = await uploadToR2Presigned(blob, {
      bucket: 'storybook-assets',
      path: 'projects/p/assets/master_video/export_en_1.mp4',
      contentType: 'video/mp4',
    });

    expect(presignBody()).toEqual({
      bucket: 'storybook-assets',
      path: 'projects/p/assets/master_video/export_en_1.mp4',
      contentType: 'video/mp4',
      size: 4321,
    });
    expect(FakeXhr.last.method).toBe('PUT');
    expect(FakeXhr.last.url).toBe(signed.uploadUrl);
    expect(FakeXhr.last.sent).toBe(blob);
    expect(FakeXhr.last.headers).toEqual(returned);
    expect(result.publicUrl).toBe(signed.publicUrl);
  });
});
