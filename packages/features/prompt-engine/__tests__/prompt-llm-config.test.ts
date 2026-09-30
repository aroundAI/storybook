import { describe, expect, it } from 'vitest';

import { assertPromptLlm } from '../src/lib/render-template';
import { loadAndRenderPrompt } from '../src/lib/server/prompt-loader';
import { PROMPT_REGISTRY } from '../src/lib/server/prompt-registry';

// FILM-1805: a prompt file names its own provider and model. The executors
// used to fill a gap with 'local' / 'claude-sonnet-4-5' (prompt-engine) or
// 'deepseek' / 'deepseek-chat' (the Lambda copy), so a stale model name could
// hide where a prompt really ran.

describe('a prompt file without provider or model', () => {
  it.each([
    ['no llm block', {}, /llm\.provider and llm\.model/],
    ['no provider', { llm: { model: 'm' } }, /llm\.provider$/],
    ['no model', { llm: { provider: 'gemini' } }, /llm\.model$/],
    [
      'an empty model',
      { llm: { provider: 'gemini', model: '' } },
      /llm\.model$/,
    ],
  ])('is a validation error: %s', (_, template, message) => {
    expect(() => assertPromptLlm('probe', template)).toThrow(message);
  });

  it('is refused by the loader, naming the prompt', async () => {
    const original = PROMPT_REGISTRY['story-ideation']!;

    PROMPT_REGISTRY['story-ideation'] = {
      ...original,
      llm: { ...original.llm, provider: '' },
    };

    try {
      await expect(loadAndRenderPrompt('story-ideation', {})).rejects.toThrow(
        /story-ideation must set llm\.provider/,
      );
    } finally {
      PROMPT_REGISTRY['story-ideation'] = original;
    }
  });

  it('holds for none of the bundled prompts', () => {
    const entries = Object.entries(PROMPT_REGISTRY);

    expect(entries.length).toBeGreaterThan(25);

    for (const [slug, template] of entries) {
      expect(() => assertPromptLlm(slug, template)).not.toThrow();
    }
  });
});
