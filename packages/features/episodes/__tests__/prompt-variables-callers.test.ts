import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SERVER_GENERATION_OFF_REFUSAL } from '@kit/ai-gateway';
import { RunError } from '@kit/generation';
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
const PROJECT = '11111111-1111-4111-8111-111111111111';
const TEAM = '22222222-2222-4222-8222-222222222222';
const refused = vi.hoisted(() => ({ error: null as Error | null }));
const opened = vi.hoisted(
  () => [] as Array<{ accountId: string; ctxAccountId: string }>,
);
const writeFails = vi.hoisted(() => ({ on: false }));

vi.mock('@kit/ai-gateway', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kit/ai-gateway')>();
  return {
    ...actual,
    executeLLM: async (config: {
      templateSlug: string;
      variables: Record<string, unknown>;
    }) => {
      calls.push(config);
      return { data: { description: 'A tall detective.', episodes: [] } };
    },
    // The sidebar's description is written through a run (FILM-1902): the
    // fake run records the brief's prompt the way the executor stub does
    openRun: async (
      _stage: string,
      target: { accountId: string },
      _origin: unknown,
      ctx: { accountId: string },
    ) => {
      opened.push({ accountId: target.accountId, ctxAccountId: ctx.accountId });
      if (refused.error) throw refused.error;

      return {
        id: 'run-under-test',
        mode: 'server',
        write: async (brief: {
          prompt: { slug: string; variables: Record<string, unknown> };
        }) => {
          if (writeFails.on) throw new Error('model down');
          calls.push({
            templateSlug: brief.prompt.slug,
            variables: brief.prompt.variables,
          });
          return { output: { description: 'A tall detective.' } };
        },
        complete: async () => undefined,
        fail: async () => undefined,
        toGenerationRun: () => ({
          mode: 'server',
          origin: { kind: 'server', at: new Date().toISOString() },
        }),
      };
    },
  };
});

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: async () => ({ data: { id: 'u1' }, error: null }),
}));
vi.mock('@kit/supabase/server-client', () => ({
  // The project's team account, which the sidebar's run belongs to (KB-187)
  getSupabaseServerClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { account_id: TEAM }, error: null }),
        }),
      }),
    }),
  }),
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
  refused.error = null;
  writeFails.on = false;
  opened.length = 0;
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
      projectId: PROJECT,
      name: 'Maya Chen',
      type: 'character',
      role: 'the accountant',
      storyContext: 'Maya Chen, 34, works late on the 40th floor.',
    });

    expect(result).toEqual({
      ok: true,
      data: { success: true, data: { description: 'A tall detective.' } },
    });
    expect(await rendered()).toContain('Known role: the accountant');
  });

  it('leaves the description empty and says in words why no model ran (KB-182)', async () => {
    const { extractDescriptionAction } = await import(
      '../src/lib/server/mutations/asset-link-actions'
    );
    refused.error = new RunError('SERVER_GENERATION_DISABLED', 'internal');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const result = await extractDescriptionAction({
      projectId: PROJECT,
      name: 'Maya Chen',
      type: 'character',
      storyContext: 'Maya Chen, 34, works late on the 40th floor.',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        success: true,
        data: { description: '', notice: SERVER_GENERATION_OFF_REFUSAL },
      },
    });

    error.mockRestore();
  });

  it('opens the run on the project’s team account, not the user’s (KB-187)', async () => {
    const { extractDescriptionAction } = await import(
      '../src/lib/server/mutations/asset-link-actions'
    );

    await extractDescriptionAction({
      projectId: PROJECT,
      name: 'Maya Chen',
      type: 'character',
      storyContext: 'Maya Chen, 34, works late on the 40th floor.',
    });

    expect(opened).toEqual([{ accountId: TEAM, ctxAccountId: TEAM }]);
  });

  it('says a real failure failed, rather than returning a silent empty description (KB-187)', async () => {
    const { extractDescriptionAction } = await import(
      '../src/lib/server/mutations/asset-link-actions'
    );
    writeFails.on = true;
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const result = await extractDescriptionAction({
      projectId: PROJECT,
      name: 'Maya Chen',
      type: 'character',
      storyContext: 'Maya Chen, 34, works late on the 40th floor.',
    });

    expect(result).toEqual({
      ok: true,
      data: {
        success: true,
        data: {
          description: '',
          notice:
            'The description could not be generated. Write one yourself, or try again.',
        },
      },
    });

    error.mockRestore();
  });
});
