/**
 * The arguments the server render gives FFmpeg, built from rows in the
 * real edit-suite columns (KB-32). Values are chosen so a wrong source
 * column gives a different string: V2 is trimmed 1000-2000 of its source
 * while sitting at 2000-3000 on the timeline, and the project is 1280x720
 * rather than the 1920x1080 default.
 */
import { describe, expect, it } from 'vitest';

import { buildFFmpegArgs } from '../handlers/ffmpeg-render';
import type { RenderClip, RenderTrack } from '../render-input';

const project = { id: 'p', episode_id: 'e', width: 1280, height: 720, fps: 30 };

const tracks: RenderTrack[] = [
  {
    id: 'v',
    type: 'video',
    name: 'V',
    sort_order: 0,
    volume: 1,
    is_muted: false,
  },
  {
    id: 'd',
    type: 'dialogue',
    name: 'D',
    sort_order: 1,
    volume: 0.5,
    is_muted: false,
  },
];

const base = {
  volume: 1,
  speed: 1,
  fade_in_ms: 0,
  fade_out_ms: 0,
  language: null,
  is_active: true,
};

const clips: RenderClip[] = [
  {
    ...base,
    id: 'v1',
    track_id: 'v',
    media_url: 'https://m.invalid/v1.mp4',
    start_ms: 0,
    end_ms: 2000,
    in_point_ms: 0,
    out_point_ms: 2000,
  },
  {
    ...base,
    id: 'v2',
    track_id: 'v',
    media_url: 'https://m.invalid/v2.mp4',
    start_ms: 2000,
    end_ms: 3000,
    in_point_ms: 1000,
    out_point_ms: 2000,
  },
  {
    ...base,
    id: 'en',
    track_id: 'd',
    media_url: 'https://m.invalid/en.m4a',
    start_ms: 500,
    end_ms: 2500,
    in_point_ms: 0,
    out_point_ms: 2000,
    language: 'en',
  },
];

const mediaMap = new Map(clips.map((c) => [c.id, `/work/${c.id}`]));

const args = buildFFmpegArgs(project, tracks, clips, mediaMap, '/work/out.mp4');
const graph = args[args.indexOf('-filter_complex') + 1]!;
const after = (flag: string) => args[args.indexOf(flag) + 1];

describe('buildFFmpegArgs (KB-32)', () => {
  it('trims each video clip to its source in/out points', () => {
    expect(graph).toContain('[0:v]trim=0:2,');
    expect(graph).toContain('[1:v]trim=1:2,');
  });

  it("scales and pads to the project's width and height", () => {
    expect(graph).toContain(
      'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720',
    );
  });

  it('places an audio clip at its timeline start with clip × track volume', () => {
    expect(graph).toContain(
      '[2:a]atrim=0:2,asetpts=PTS-STARTPTS,volume=0.5,adelay=500|500',
    );
  });

  it("writes the project's frame rate", () => {
    expect(after('-r')).toBe('30');
  });

  it('writes 4:2:0 so browsers and QuickTime can play the file', () => {
    expect(after('-pix_fmt')).toBe('yuv420p');
  });
});
