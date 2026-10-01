import { describe, expect, it } from 'vitest';

import { readMp4Facts } from '../src/lib/mp4-facts';
import { mp4, serve } from './mp4-fixture';

/**
 * FILM-1729. X's limits are checked before a publish row is written, from the
 * MP4's own header, read with range requests rather than downloading the file.
 */

describe('readMp4Facts', () => {
  it('reads length, size and shape from the header', async () => {
    const file = mp4({ seconds: 42.5, width: 1080, height: 1920 });
    const { fetcher } = serve(file);

    expect(await readMp4Facts('https://storage/v.mp4', fetcher)).toEqual({
      bytes: file.length,
      durationSeconds: 42.5,
      width: 1080,
      height: 1920,
    });
  });

  it('finds the header after the media without downloading the media', async () => {
    const file = mp4({
      seconds: 90,
      width: 1920,
      height: 1080,
      moovLast: true,
      mdatBytes: 200_000,
    });
    const { fetcher, served } = serve(file);

    expect(await readMp4Facts('https://storage/v.mp4', fetcher)).toMatchObject({
      durationSeconds: 90,
      width: 1920,
      height: 1080,
    });
    expect(served.reduce((n, b) => n + b, 0)).toBeLessThan(10_000);
  });

  it('reports a rotated phone video in the shape it plays', async () => {
    const { fetcher } = serve(
      mp4({ seconds: 10, width: 1920, height: 1080, rotated: true }),
    );

    expect(await readMp4Facts('https://storage/v.mp4', fetcher)).toMatchObject({
      width: 1080,
      height: 1920,
    });
  });

  it('says nothing it cannot read from a file that is not an MP4', async () => {
    const file = new Uint8Array(4096).fill(7);
    const { fetcher } = serve(file);

    expect(await readMp4Facts('https://storage/v.mp4', fetcher)).toEqual({
      bytes: file.length,
      durationSeconds: null,
      width: null,
      height: null,
    });
  });
});
