import { describe, expect, it } from 'vitest';

import { loadAndRenderPrompt } from '../src/lib/server/prompt-loader';

/**
 * One rule for a prompt's placeholders, in both executors (KB-126 follow-up).
 * The prompt-engine renderer used to leave an unfilled placeholder in the
 * text, so the model was sent `{{characters}}`; the Lambda renderer blanked
 * it, so the data vanished without a trace. Both now refuse: a placeholder
 * with no value and no default is an error, not something sent to a model.
 * `prompt-variables.test.ts` checks every call statically; this checks the
 * executor at run time. The Lambda's twin is
 * `apps/web/lambda/llm-worker/__tests__/render-prompt.test.ts`.
 */

const outline = {
  season_premise: 'A whistleblower season',
  episode_count: 3,
  starting_number: 1,
  genre: 'drama',
  style: 'cinematic',
  characters: '- Maya Chen',
  locations: '- The 40th floor',
  verified_facts: '',
  recurring_element: '',
  surrounding_episodes: '',
};

describe('prompt-engine rendering', () => {
  it('fills every placeholder it is given', async () => {
    const prompt = await loadAndRenderPrompt('season-outline', outline);

    expect(prompt.userPrompt).toContain('- Maya Chen');
    expect(prompt.userPrompt).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('refuses an optional placeholder left unfilled, naming it', async () => {
    const { characters: _left, ...withoutCharacters } = outline;

    await expect(
      loadAndRenderPrompt('season-outline', withoutCharacters),
    ).rejects.toThrow(/season-outline.*unfilled.*\{\{characters\}\}/);
  });

  it('does not expand a placeholder that arrives inside a value', async () => {
    const prompt = await loadAndRenderPrompt('season-outline', {
      ...outline,
      characters: 'Maya says {{locations}}',
    });

    expect(prompt.userPrompt).toContain('Maya says {{locations}}');
  });
});
