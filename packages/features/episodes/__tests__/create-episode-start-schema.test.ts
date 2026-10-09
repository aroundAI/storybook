import { describe, expect, it } from 'vitest';
import type { z } from 'zod';

import {
  CreateEpisodeStartSchema,
  ImportScreenplaySchema,
} from '../src/lib/schemas/create-episode-start.schema';

/**
 * FILM-2205: a dialog whose script field was never touched submits no
 * script at all, not an empty one. The refusal must say what to do either
 * way, not Zod's bare "Required".
 */
const MESSAGE = 'Paste the script, or choose a file';

function scriptError(result: { success: boolean; error?: z.ZodError }) {
  return result.error?.issues.find((issue) => issue.path[0] === 'script')
    ?.message;
}

describe('a missing script', () => {
  const start = {
    projectId: '00000000-0000-4000-8000-000000000001',
    seasonId: null,
    title: 'Empty',
    startFrom: 'script',
  };

  it.each([
    ['never typed', {}],
    ['empty', { script: '' }],
    ['blank', { script: '   ' }],
  ])('is refused with what to do when %s', (_, script) => {
    expect(
      scriptError(CreateEpisodeStartSchema.safeParse({ ...start, ...script })),
    ).toBe(MESSAGE);
  });

  it('is refused the same way when importing over MCP', () => {
    expect(
      scriptError(
        ImportScreenplaySchema.safeParse({
          episodeId: '00000000-0000-4000-8000-000000000002',
          version: 1,
        }),
      ),
    ).toBe(MESSAGE);
  });
});
