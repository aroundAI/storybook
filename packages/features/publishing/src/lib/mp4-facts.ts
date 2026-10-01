import type { VideoFacts } from '@kit/shared/vendors';

/**
 * A video's length and shape, read from its MP4 header with HTTP range
 * requests (FILM-1729), so X's limits are checked before anything is written
 * and without downloading the video. Walks the top-level boxes by their
 * headers until `moov`, which may sit before or after the media, then reads
 * `mvhd` (duration) and the first video track's `tkhd` (width and height,
 * turned for a rotated recording).
 *
 * Never throws for a file it cannot read: a field it could not find is null,
 * and the caller decides what that means.
 */

/** A `moov` larger than this is not read. Real ones are well under a megabyte. */
const MAX_MOOV_BYTES = 32 * 1024 * 1024;
/** Top-level boxes to step over before giving up. */
const MAX_TOP_LEVEL_BOXES = 64;

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

async function readRange(
  url: string,
  fetcher: Fetcher,
  from: number,
  length: number,
) {
  const response = await fetcher(url, {
    headers: { Range: `bytes=${from}-${from + length - 1}` },
  });

  if (!response.ok) return null;

  const total = /\/(\d+)$/.exec(
    response.headers.get('content-range') ?? '',
  )?.[1];

  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    total: total ? Number(total) : null,
  };
}

function typeAt(bytes: Uint8Array, at: number) {
  return String.fromCharCode(...bytes.subarray(at + 4, at + 8));
}

/** The children of a box payload, as [type, payloadStart, end]. */
function* children(bytes: Uint8Array, from: number, to: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = from;

  while (at + 8 <= to) {
    const size = view.getUint32(at);

    if (size < 8 || at + size > to) return;

    yield [typeAt(bytes, at), at + 8, at + size] as const;
    at += size;
  }
}

function readMoov(moov: Uint8Array) {
  const view = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  let durationSeconds: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  for (const [type, start, end] of children(moov, 8, moov.length)) {
    if (type === 'mvhd') {
      const v1 = view.getUint8(start) === 1;
      const timescale = view.getUint32(start + (v1 ? 20 : 12));
      const duration = v1
        ? Number(view.getBigUint64(start + 24))
        : view.getUint32(start + 16);

      if (timescale > 0) durationSeconds = duration / timescale;
    }

    if (type === 'trak' && width === null) {
      for (const [inner, at] of children(moov, start, end)) {
        if (inner !== 'tkhd') continue;

        const shift = view.getUint8(at) === 1 ? 12 : 0;
        const w = view.getUint32(at + 76 + shift) / 0x10000;
        const h = view.getUint32(at + 80 + shift) / 0x10000;

        // An audio track has no size; the first track that has one is the video.
        if (w > 0 && h > 0) {
          const a = view.getInt32(at + 40 + shift);
          const turned = a === 0;

          width = Math.round(turned ? h : w);
          height = Math.round(turned ? w : h);
        }
      }
    }
  }

  return { durationSeconds, width, height };
}

export async function readMp4Facts(
  url: string,
  fetcher: Fetcher = fetch,
): Promise<VideoFacts> {
  const facts: VideoFacts = {
    bytes: null,
    durationSeconds: null,
    width: null,
    height: null,
  };

  try {
    let at = 0;

    for (let boxes = 0; boxes < MAX_TOP_LEVEL_BOXES; boxes++) {
      const head = await readRange(url, fetcher, at, 16);

      if (!head || head.bytes.length < 8) break;
      facts.bytes ??= head.total;

      const view = new DataView(head.bytes.buffer);
      let size = view.getUint32(0);
      const type = typeAt(head.bytes, 0);

      if (size === 1 && head.bytes.length >= 16) {
        size = Number(view.getBigUint64(8));
      } else if (size === 0 && facts.bytes !== null) {
        size = facts.bytes - at;
      }

      if (size < 8) break;

      if (type === 'moov') {
        if (size > MAX_MOOV_BYTES) break;

        const moov = await readRange(url, fetcher, at, size);

        if (moov && moov.bytes.length === size) {
          Object.assign(facts, readMoov(moov.bytes));
        }
        break;
      }

      at += size;
      if (facts.bytes !== null && at >= facts.bytes) break;
    }
  } catch {
    // An unreadable file is reported as unknown fields, never as a throw.
  }

  return facts;
}
