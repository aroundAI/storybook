import { beforeEach, describe, expect, it, vi } from 'vitest';

import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';

import { seasonOutlinerSkill } from '../src/agent/skills/season-outliner-skill';
import { formatNeighbouringEpisodes } from '../src/lib/neighbouring-episodes';

/**
 * KB-121. Regenerating one episode's outline sent the outlines around it
 * (`surroundingEpisodes`) and the writer's note (`additionalContext`) with
 * the job, and nothing read them: the episode was written as if it stood
 * alone. They now travel with the job and reach the outline prompt.
 */

const variables = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@kit/ai-gateway', () => ({
  executeLLM: async (config: { variables: Record<string, unknown> }) => {
    variables.push(config.variables);
    return { data: { episodes: [] } };
  },
}));

const before = {
  number: 2,
  title: 'The Leak',
  premise: 'Maya finds the memo.',
  mainPlot: 'She decides who to tell, and tells the wrong person.',
  characterFocus: ['Maya'],
  arcPosition: 'rising',
};
const after = {
  number: 4,
  title: 'Fallout',
  premise: 'The board meets.',
  mainPlot: 'Maya is asked to resign and refuses.',
  arcPosition: 'climax',
};

beforeEach(() => {
  variables.length = 0;
});

describe('neighbouring episodes (KB-121)', () => {
  it('travel with the queued job', () => {
    const job = parseLlmJobPayload('season-outline', {
      accountId: '11111111-1111-4111-8111-111111111111',
      projectId: '22222222-2222-4222-8222-222222222222',
      userId: '44444444-4444-4444-8444-444444444444',
      seasonPremise: 'A whistleblower season',
      episodeCount: 1,
      startingNumber: 3,
      surroundingEpisodes: [after, before],
      additionalContext: 'Keep Maya sympathetic.',
    });

    expect(job.surroundingEpisodes).toHaveLength(2);
    expect(job.additionalContext).toBe('Keep Maya sympathetic.');
  });

  it('are written into context in episode order, with the writer’s note', () => {
    const text = formatNeighbouringEpisodes(
      [after, before],
      'Keep Maya sympathetic.',
    );

    expect(text.indexOf('Episode 2')).toBeLessThan(text.indexOf('Episode 4'));
    expect(text).toContain('"The Leak"');
    expect(text).toContain('Focus: Maya');
    expect(text).toContain('Keep Maya sympathetic.');
  });

  it('are empty when there is nothing around the episode', () => {
    expect(formatNeighbouringEpisodes([], '  ')).toBe('');
  });

  it('reach the outline prompt from the job, whatever the tool call says', async () => {
    const tool = seasonOutlinerSkill.tools[0]!;

    await tool.execute(
      {
        seasonPremise: 'A whistleblower season',
        episodeCount: 1,
        startingNumber: 3,
        genre: 'drama',
        style: 'cinematic',
        existingCharacters: '',
        existingLocations: '',
        recurringElements: '',
      },
      {
        accountId: '11111111-1111-4111-8111-111111111111',
        _neighbouringEpisodes: formatNeighbouringEpisodes([before]),
      },
    );

    expect(variables[0]?.surrounding_episodes).toContain('"The Leak"');
  });
});
