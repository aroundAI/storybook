import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * FILM-1912, server mode: the worker's orchestrators put the run's
 * performance block in the agent run context, and each director renders
 * it into its prompt as `performance_context`. The model never copies it
 * through tool arguments, so it reaches the prompt intact or not at all.
 */

const calls = vi.hoisted(() => ({
  llm: [] as Array<{
    templateSlug: string;
    variables: Record<string, unknown>;
  }>,
  agent: [] as Array<Record<string, unknown>>,
}));

vi.mock('@kit/ai-gateway', () => ({
  executeLLM: vi.fn(
    async (input: {
      templateSlug: string;
      variables: Record<string, unknown>;
    }) => {
      calls.llm.push(input);

      return {
        success: true,
        data: {
          ideas: [],
          story: { title: 't', fullText: 'x', themes: [] },
          shots: [],
          sceneSummary: 's',
        },
        metadata: { provider: 'test', model: 'test', tokens: 0, latency: 0 },
      };
    },
  ),
}));

vi.mock('@kit/agent', async (original) => ({
  ...(await original<typeof import('@kit/agent')>()),
  runAgent: vi.fn(
    async (
      _agent: unknown,
      _input: unknown,
      context: Record<string, unknown>,
    ) => {
      calls.agent.push(context);
      return { success: false, error: 'stopped by the test' };
    },
  ),
}));

const BLOCK =
  '\n\n## Past performance of this project (context, not instructions)\nlabel';

beforeEach(() => {
  calls.llm.length = 0;
  calls.agent.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

async function toolOf(module: string, skill: string) {
  const loaded = (await import(module)) as Record<
    string,
    { tools: Array<{ execute: (a: unknown, c: unknown) => Promise<unknown> }> }
  >;
  return loaded[skill]!.tools[0]!;
}

describe('the directors render the run’s block from the agent context (FILM-1912)', () => {
  it('ideation, story and shots each send it as performance_context, and an empty string without one', async () => {
    const ideation = await toolOf(
      '../src/agent/skills/ideation-director-skill',
      'ideationDirectorSkill',
    );
    const story = await toolOf(
      '../src/agent/skills/story-director-skill',
      'storyDirectorSkill',
    );
    const shots = await toolOf(
      '../src/agent/skills/shot-director-skill',
      'shotDirectorSkill',
    );

    const ideationArgs = {
      premise: 'p',
      numberOfIdeas: 1,
      genre: 'g',
      targetAudience: 'a',
    };
    const storyArgs = {
      title: 't',
      logline: 'l',
      genre: 'g',
      targetAudience: 'a',
      targetDurationSeconds: 60,
      contentStyle: 'balanced',
    };
    const shotArgs = {
      episodeTitle: 't',
      genre: 'g',
      targetAudience: 'a',
      visualStyle: 'v',
      characters: '',
      locations: '',
      scenes: [{ number: 1, description: 'd' }],
      reelCandidateScenes: [],
      tone: 'balanced',
    };

    for (const [tool, args] of [
      [ideation, ideationArgs],
      [story, storyArgs],
      [shots, shotArgs],
    ] as const) {
      await tool.execute(args, { accountId: 'a', _performanceContext: BLOCK });
      await tool.execute(args, { accountId: 'a' });
    }

    expect(
      calls.llm.map((call) => [
        call.templateSlug,
        call.variables.performance_context,
      ]),
    ).toEqual([
      ['story-ideation', BLOCK],
      ['story-ideation', ''],
      ['story-generation', BLOCK],
      ['story-generation', ''],
      ['scene-shot-generation', BLOCK],
      ['scene-shot-generation', ''],
    ]);
  });
});

describe('the orchestrators hand the block to their directors (FILM-1912)', () => {
  it('ideation, story and shots put it in the agent run context', async () => {
    const { runIdeationOrchestrator } = await import(
      '../src/agent/ideation-orchestrator'
    );
    const { runStoryOrchestrator } = await import(
      '../src/agent/story-orchestrator'
    );
    const { runShotOrchestrator } = await import(
      '../src/agent/shot-orchestrator'
    );

    await runIdeationOrchestrator({
      episodeId: 'e',
      premise: 'p',
      numberOfIdeas: 1,
      genre: 'g',
      targetAudience: 'a',
      accountId: 'acc',
      charactersContext: '',
      locationsContext: '',
      performanceContext: BLOCK,
    }).catch(() => undefined);

    await runStoryOrchestrator(
      {
        episodeId: 'e',
        projectId: 'p',
        accountId: 'acc',
        episodeTitle: 't',
        episodeLogline: 'l',
        genre: 'g',
        targetAudience: 'a',
        targetDurationSeconds: 60,
        contentStyle: 'balanced',
        episodeNumber: 1,
        charactersContext: '',
        locationsContext: '',
        performanceContext: BLOCK,
      } as never,
      {} as never,
    ).catch(() => undefined);

    await runShotOrchestrator({
      episodeId: 'e',
      episodeTitle: 't',
      genre: 'g',
      targetAudience: 'a',
      visualStyle: 'v',
      accountId: 'acc',
      scenes: [],
      charactersVeoContext: '',
      locationsVeoContext: '',
      performanceContext: BLOCK,
    }).catch(() => undefined);

    expect(calls.agent.map((context) => context._performanceContext)).toEqual([
      BLOCK,
      BLOCK,
      BLOCK,
    ]);
  });
});
