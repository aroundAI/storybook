import { describe, expect, it, vi } from 'vitest';

import { readMp4Facts } from '../src/lib/mp4-facts';

/**
 * FILM-1729. X's limits are checked before a publish row is written, from the
 * MP4's own header, read with range requests rather than downloading the file.
 */

function box(type: string, payload: Uint8Array) {
  const out = new Uint8Array(8 + payload.length);
  const view = new DataView(out.buffer);

  view.setUint32(0, out.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(payload, 8);

  return out;
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;

  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }

  return out;
}

function mvhd(timescale: number, duration: number) {
  const payload = new Uint8Array(100);
  const view = new DataView(payload.buffer);

  view.setUint32(12, timescale);
  view.setUint32(16, duration);

  return box('mvhd', payload);
}

function tkhd(width: number, height: number, rotated = false) {
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);

  // matrix a, b: identity, or a 90° turn (a = 0, b = 1.0)
  view.setInt32(40, rotated ? 0 : 0x10000);
  view.setInt32(44, rotated ? 0x10000 : 0);
  view.setUint32(76, width * 0x10000);
  view.setUint32(80, height * 0x10000);

  return box('tkhd', payload);
}

function mp4(options: {
  seconds: number;
  width: number;
  height: number;
  rotated?: boolean;
  moovLast?: boolean;
  mdatBytes?: number;
}) {
  const ftyp = box('ftyp', new TextEncoder().encode('isom\0\0\0\0isomavc1'));
  const audio = box('trak', tkhd(0, 0));
  const video = box(
    'trak',
    tkhd(options.width, options.height, options.rotated),
  );
  const moov = box(
    'moov',
    concat(mvhd(1000, options.seconds * 1000), audio, video),
  );
  const mdat = box('mdat', new Uint8Array(options.mdatBytes ?? 64));

  return options.moovLast ? concat(ftyp, mdat, moov) : concat(ftyp, moov, mdat);
}

/** A storage server that answers Range requests, and counts what it served. */
function serve(file: Uint8Array) {
  const served: number[] = [];
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range') ?? '';
    const [, from, to] = /bytes=(\d+)-(\d+)/.exec(range) ?? [];
    const start = Number(from);
    const end = Math.min(Number(to), file.length - 1);
    const body = file.slice(start, end + 1);

    served.push(body.length);

    return new Response(body, {
      status: 206,
      headers: { 'content-range': `bytes ${start}-${end}/${file.length}` },
    });
  });

  return { fetcher, served };
}

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
