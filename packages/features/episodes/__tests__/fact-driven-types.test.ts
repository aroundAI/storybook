import { describe, expect, it } from 'vitest';

import { ProjectTypeSchema } from '@kit/film-studio-schemas/project';
import {
  FACT_DRIVEN_PROJECT_TYPES,
  requiresVerifiedFacts,
} from '@kit/generation/project-type';

import { getContentTypeConfig } from '../src/lib/canon/content-type-configs';

/**
 * FILM-1901: the season stages decide from `@kit/generation`'s list whether
 * a project's verified facts go into the prompt (KB-71); the canon configs
 * here say the same with `requiresFacts`. This holds the two together.
 */
describe('fact-driven project types', () => {
  it('are exactly the types whose content-type config requires facts', () => {
    const fromConfigs = ProjectTypeSchema.options.filter(
      (type) => getContentTypeConfig(type).requiresFacts,
    );

    expect([...FACT_DRIVEN_PROJECT_TYPES].sort()).toEqual(fromConfigs.sort());

    for (const type of ProjectTypeSchema.options) {
      expect(requiresVerifiedFacts(type)).toBe(
        getContentTypeConfig(type).requiresFacts,
      );
    }
  });
});
