import { describe, expect, it } from 'vitest';

import { registeredStageKeys } from '../../src';

/**
 * FILM-1901 part B: importing the package registers the story, ideation and
 * season stages, so the worker and the MCP tools find them by key.
 */
describe('registered stages', () => {
  it('include story, ideation, season_outline and season_analysis', () => {
    expect(registeredStageKeys()).toEqual(
      expect.arrayContaining([
        'story',
        'ideation',
        'season_outline',
        'season_analysis',
      ]),
    );
  });
});
