import { describe, expect, it } from 'vitest';

import {
  type RenderClip,
  type RenderTrack,
  selectRenderClips,
} from '../render-input';

const track = (id: string, type: string, is_muted = false): RenderTrack => ({
  id,
  type,
  name: id,
  sort_order: 0,
  volume: 1,
  is_muted,
});

const clip = (
  id: string,
  track_id: string,
  language: string | null,
  is_active: boolean,
): RenderClip => ({
  id,
  track_id,
  media_url: `https://media.test.invalid/${id}.mp4`,
  start_ms: 0,
  end_ms: 1000,
  in_point_ms: 0,
  out_point_ms: 1000,
  volume: 1,
  speed: 1,
  fade_in_ms: 0,
  fade_out_ms: 0,
  language,
  is_active,
});

// The shape auto-assemble writes with an English preview: the English line
// active, its Spanish dub inactive (auto-assemble.ts, "Non-primary language
// starts inactive").
const tracks = [
  track('video', 'video'),
  track('dialogue', 'dialogue'),
  track('music', 'music', true),
];
const clips = [
  clip('shot', 'video', null, true),
  clip('en-line', 'dialogue', 'en', true),
  clip('es-dub', 'dialogue', 'es', false),
  clip('hidden-shot', 'video', null, false),
  clip('score', 'music', null, true),
];

const ids = (language: string) =>
  selectRenderClips(tracks, clips, language).map((c) => c.id);

describe('selectRenderClips (KB-32)', () => {
  it('a Spanish render includes the Spanish dub although the preview shows English', () => {
    expect(ids('es')).toEqual(['shot', 'es-dub']);
  });

  it('an English render includes the English line and not the Spanish dub', () => {
    expect(ids('en')).toEqual(['shot', 'en-line']);
  });

  it('a clip with no language follows is_active', () => {
    expect(ids('en')).not.toContain('hidden-shot');
    expect(ids('es')).not.toContain('hidden-shot');
  });

  it('a clip on a muted track is left out', () => {
    expect(ids('en')).not.toContain('score');
  });

  it('a clip whose track is not in the project is left out', () => {
    const orphan = clip('orphan', 'no-such-track', null, true);

    expect(selectRenderClips(tracks, [orphan], 'en')).toEqual([]);
  });
});
