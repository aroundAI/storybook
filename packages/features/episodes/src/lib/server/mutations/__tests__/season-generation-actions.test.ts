import { describe, expect, it, vi } from 'vitest';

import {
  analyzeSeasonRoadmapAction,
  generateSeasonEpisodesAction,
} from '../season-generation-actions';

describe('Season Generation Actions', () => {
  it('should export analyzeSeasonRoadmapAction', () => {
    expect(analyzeSeasonRoadmapAction).toBeDefined();
  });

  it('should export generateSeasonEpisodesAction', () => {
    expect(generateSeasonEpisodesAction).toBeDefined();
  });
});
