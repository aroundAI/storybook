import { describe, expect, it } from 'vitest';

import { sampleGateCopy } from '../src/components/taxonomy/tag-medians-copy';

describe('sampleGateCopy', () => {
  it('describes a tag gate in terms of tagging', () => {
    const copy = sampleGateCopy('tag', 30, 12);

    expect(copy.headline).toContain('Tag-level medians unlock once 30 videos');
    expect(copy.progressLabel).toBe('12 of 30 videos tagged');
  });

  // The whole point of the prop: a language is a `video_dim` column, not
  // something anyone tags, so the gate must not tell an operator to go and
  // tag videos.
  it('describes a language gate without calling it a tag', () => {
    const copy = sampleGateCopy('language', 30, 12);

    expect(copy.headline).toMatch(/language/i);
    expect(copy.headline).not.toMatch(/tag/i);
    expect(copy.progressLabel).toBe('12 of 30 videos with a language');
    expect(copy.progressLabel).not.toMatch(/tag/i);
  });
});
