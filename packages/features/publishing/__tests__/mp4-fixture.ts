import { vi } from 'vitest';

/**
 * A minimal MP4 (ftyp, moov with mvhd and tracks, mdat) and a storage server
 * that answers Range requests — shared by the tests that read a header.
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

export function mp4(options: {
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
export function serve(file: Uint8Array) {
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
