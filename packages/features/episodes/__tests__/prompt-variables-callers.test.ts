import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAndRenderPrompt } from '@kit/prompt-engine/server';

/**
 * KB-126. Callers sent the right data under names their prompts do not read.
 * `prompt-engine/__tests__/prompt-variables.test.ts` checks every call's
 * names against its template; these check what the model now receives, by
 * rendering the prompt with what each caller sends.
 */

const calls = vi.hoisted(
  () =>
    [] as Array<{ templateSlug: string; variables: Record<string, unknown> }>,
);

vi.mock('@kit/prompt-engine/server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@kit/prompt-engine/server')>();
  return {
    ...actual,
    executeLLM: async (config: {
      templateSlug: string;
      variables: Record<string, unknown>;
    }) => {
      calls.push(config);
      return { data: { description: 'A tall detective.', episodes: [] } };
    },
  };
});

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'u1' }, error: null }),
}));
vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({}),
}));
vi.mock('@kit/next/actions', () => ({
  enhanceAction: (fn: (data: unknown) => unknown) => fn,
}));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

async function rendered() {
  const call = calls.at(-1)!;
  const prompt = await loadAndRenderPrompt(call.templateSlug, call.variables);
  return `${prompt.systemPrompt}\n${prompt.userPrompt}`;
}

beforeEach(() => {
  calls.length = 0;
});

describe('the season outliner (KB-126)', () => {
  it('gives the model the project’s characters, locations, recurring elements and facts', async () => {
    const { seasonOutlinerSkill } = await import(
      '../src/agent/skills/season-outliner-skill'
    );

    await seasonOutlinerSkill.tools[0]!.execute(
      {
        seasonPremise: 'A whistleblower season',
        episodeCount: 3,
        startingNumber: 1,
        genre: 'drama',
        style: 'cinematic',
        existingCharacters: '- Maya Chen: the accountant',
        existingLocations: '- The 40th floor',
        recurringElements: 'Each episode ends on a voicemail',
      },
      {
        accountId: 'a1',
        _verifiedFacts: 'FACT [f1]: The firm was fined in 2019',
      },
    );

    const text = await rendered();

    expect(text).toContain('Maya Chen');
    expect(text).toContain('The 40th floor');
    expect(text).toContain('Each episode ends on a voicemail');
    expect(text).toContain('The firm was fined in 2019');
    expect(text).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });
});

describe('the story director (KB-126)', () => {
  it('gives the model the verified facts and the viral goals', async () => {
    const { storyDirectorSkill } = await import(
      '../src/agent/skills/story-director-skill'
    );

    await storyDirectorSkill.tools[0]!.execute(
      {
        title: 'The Leak',
        logline: 'Maya finds the memo and has to decide who to trust.',
        genre: 'drama',
        targetAudience: 'adults',
        targetDurationSeconds: 300,
        contentStyle: 'balanced',
        viralGoals: 'End Act 1 on a withheld fact',
      },
      { accountId: 'a1', _verifiedFacts: 'FACT [f1]: The firm was fined' },
    );

    const text = await rendered();

    expect(text).toContain('The firm was fined');
    expect(text).toContain('End Act 1 on a withheld fact');
  });
});

describe('the ideation director (KB-126)', () => {
  it('tells the model which ideas to regenerate', async () => {
    const { ideationDirectorSkill } = await import(
      '../src/agent/skills/ideation-director-skill'
    );

    await ideationDirectorSkill.tools[0]!.execute(
      {
        premise: 'A whistleblower finds the memo',
        numberOfIdeas: 3,
        genre: 'drama',
        targetAudience: 'adults',
        weakIndices: '[0, 2]',
      },
      { accountId: 'a1' },
    );

    expect(await rendered()).toContain(
      'Regenerate only the ideas at these positions (0-based): [0, 2]',
    );
  });
});

describe('extracting one asset’s description (KB-126)', () => {
  it('sends what the template requires, so the sidebar gets a description', async () => {
    const { extractDescriptionAction } = await import(
      '../src/lib/server/mutations/asset-link-actions'
    );

    const result = await extractDescriptionAction({
      name: 'Maya Chen',
      type: 'character',
      role: 'the accountant',
      storyContext: 'Maya Chen, 34, works late on the 40th floor.',
    });

    expect(result).toEqual({
      success: true,
      data: { description: 'A tall detective.' },
    });
    expect(await rendered()).toContain('Known role: the accountant');
  });
});
