import { describe, expect, it } from 'vitest';

import { loadAndRenderPromptForLambda } from '../llm-utils';
import { PROMPT_REGISTRY } from '../prompt-registry';

/**
 * The Lambda executor renders prompts with the same rule as prompt-engine
 * (`packages/features/prompt-engine/__tests__/render-template.test.ts`). It
 * used to blank a placeholder nobody filled, so a caller that sent its data
 * under the wrong name lost it silently (KB-126); it now refuses.
 */

const analysis = {
  roadmap: 'Season one follows a whistleblower through five weeks.',
  verified_facts: '',
  recurring_element: '',
};

describe('Lambda prompt rendering', () => {
  it('fills every placeholder it is given', () => {
    const prompt = loadAndRenderPromptForLambda('season-generation', analysis);

    expect(prompt.userPrompt).toContain('five weeks');
    expect(prompt.userPrompt).not.toMatch(/\{\{\s*\w+\s*\}\}/);
  });

  it('refuses an optional placeholder left unfilled, naming it', () => {
    const { recurring_element: _left, ...withoutRecurring } = analysis;

    expect(() =>
      loadAndRenderPromptForLambda('season-generation', withoutRecurring),
    ).toThrow(/season-generation.*unfilled.*\{\{recurring_element\}\}/);
  });

  it('renders every template exactly as prompt-engine does', async () => {
    // The loader alone: the package's server entry pulls in the executor
    const { loadAndRenderPrompt } = await import(
      '../../../../../packages/features/prompt-engine/src/lib/server/prompt-loader'
    );
    const { PROMPT_REGISTRY: ENGINE_REGISTRY } = await import(
      '../../../../../packages/features/prompt-engine/src/lib/server/prompt-registry'
    );
    const differences: string[] = [];
    // Templates both executors carry; the worker also bundles two of its own
    const shared = Object.entries(PROMPT_REGISTRY).filter(
      ([slug]) => slug in ENGINE_REGISTRY,
    );

    expect(shared.length).toBeGreaterThan(5);

    for (const [slug, template] of shared) {
      const variables = Object.fromEntries(
        Object.keys(template.variables).map((name) => [name, `<${name}>`]),
      );
      const lambda = loadAndRenderPromptForLambda(slug, variables);
      const engine = await loadAndRenderPrompt(slug, variables);

      if (
        lambda.systemPrompt !== engine.systemPrompt ||
        lambda.userPrompt !== engine.userPrompt
      ) {
        differences.push(slug);
      }
    }

    expect(differences).toEqual([]);
  });
});
