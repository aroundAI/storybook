import { describe, expect, it } from 'vitest';

import {
  AI_LABEL_FIELD,
  PLATFORMS_WITHOUT_AI_LABEL,
  aiLabelUnsupportedNote,
} from '../src/lib/ai-label';

/**
 * FILM-1731. The publish screen names the connected platforms that cannot
 * carry the AI label, from the same map the code sends from, in the
 * platforms' display names — never a hand-typed list.
 */
describe('the AI-label map', () => {
  it('has no field for Facebook Pages or LinkedIn, and one for every other platform', () => {
    expect([...PLATFORMS_WITHOUT_AI_LABEL].sort()).toEqual([
      'facebook',
      'linkedin',
    ]);
    expect(AI_LABEL_FIELD.instagram).toBe('is_ai_generated');
    expect(AI_LABEL_FIELD.youtube).toBe('status.containsSyntheticMedia');
    expect(AI_LABEL_FIELD.tiktok).toBe('post_info.is_aigc');
    expect(AI_LABEL_FIELD.twitter).toBe('made_with_ai');
  });
});

describe('aiLabelUnsupportedNote', () => {
  it('names Facebook when a Page is among the channels', () => {
    expect(aiLabelUnsupportedNote(['youtube', 'facebook', 'instagram'])).toBe(
      "Facebook can't take the AI label: its publishing API has no field for it, so the video goes out there without one.",
    );
  });

  it('names each unsupported platform once, however many channels it has', () => {
    expect(aiLabelUnsupportedNote(['facebook', 'linkedin', 'facebook'])).toBe(
      "Facebook and LinkedIn can't take the AI label: their publishing API has no field for it, so the video goes out there without one.",
    );
  });

  it('says nothing when every channel can carry the label', () => {
    expect(
      aiLabelUnsupportedNote(['youtube', 'instagram', 'tiktok', 'twitter']),
    ).toBeNull();
    expect(aiLabelUnsupportedNote([])).toBeNull();
  });
});
