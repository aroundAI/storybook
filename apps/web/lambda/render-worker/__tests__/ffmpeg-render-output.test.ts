// @vitest-environment node
/**
 * KB-32: the renderer returned the path of an output its own `finally`
 * had just deleted, so the upload that followed always failed with ENOENT.
 *
 * Runs the real `processFFmpegRender` with a stand-in `ffmpeg` (a shell
 * script that writes its last argument, which is the output path), so CI
 * needs no FFmpeg binary. Media downloads go through a stubbed `fetch` and
 * the DNS check through a mocked lookup: nothing leaves the machine.
 */
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { RenderClip, RenderTrack } from '../render-input';

vi.mock('dns/promises', () => {
  const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND (test)'));
  return { lookup, default: { lookup } };
});

const root = mkdtempSync(join(tmpdir(), 'kb32-render-test-'));
const fakeFfmpeg = join(root, 'ffmpeg');

beforeAll(() => {
  writeFileSync(
    fakeFfmpeg,
    '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nprintf fake > "$last"\n',
  );
  chmodSync(fakeFfmpeg, 0o755);
  vi.stubEnv('FFMPEG_PATH', fakeFfmpeg);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (!new URL(url).hostname.endsWith('.invalid')) {
        throw new Error(`test fetch refused ${url}`);
      }

      return new Response('media');
    }),
  );
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

const tracks: RenderTrack[] = [
  {
    id: 'v',
    type: 'video',
    name: 'V',
    sort_order: 0,
    volume: 1,
    is_muted: false,
  },
];

const clip = (id: string, start: number, end: number): RenderClip => ({
  id,
  track_id: 'v',
  media_url: `https://media.kb32.invalid/${id}.mp4`,
  start_ms: start,
  end_ms: end,
  in_point_ms: 0,
  out_point_ms: end - start,
  volume: 1,
  speed: 1,
  fade_in_ms: 0,
  fade_out_ms: 0,
  language: null,
  is_active: true,
});

describe('processFFmpegRender output (KB-32)', () => {
  it('returns an output file that still exists, inside the caller’s work dir', async () => {
    const { processFFmpegRender } = await import('../handlers/ffmpeg-render');
    const workDir = mkdtempSync(join(root, 'job-'));

    const result = await processFFmpegRender({
      project: { id: 'p', episode_id: 'e', width: 1280, height: 720, fps: 30 },
      tracks,
      clips: [clip('a', 0, 2000), clip('b', 2000, 3000)],
      language: 'en',
      workDir,
      onProgress: async () => {},
    });

    expect(result.outputPath.startsWith(workDir)).toBe(true);
    expect(existsSync(result.outputPath)).toBe(true);
    expect(result.durationMs).toBe(3000);
    // the two downloads and the output, all left for the caller to remove
    expect(readdirSync(workDir)).toHaveLength(3);
  });
});
