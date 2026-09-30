/**
 * A library, not a `'use server'` module (KB-58): every export of one of
 * those is an endpoint anyone can call. No `server-only` either: the LLM
 * worker Lambda imports this, and `server-only` throws outside Next.
 */
import { assertPromptLlm, renderTemplate } from '../render-template';
import type { RenderedPrompt } from '../types';
import { PROMPT_REGISTRY } from './prompt-registry';

/**
 * Load and render a prompt template from the bundled registry
 *
 * All prompts must be registered in prompt-registry.ts to work in both
 * local development and production (Lambda/serverless) environments.
 *
 * @param slug - Prompt slug (filename without .json extension)
 * @param variables - Variables to interpolate into the template
 * @returns Rendered prompt ready for LLM execution
 *
 * @example
 * ```typescript
 * const prompt = await loadAndRenderPrompt('story-generation', {
 *   project_name: 'My Project',
 *   genre: 'comedy',
 * });
 * ```
 */
export async function loadAndRenderPrompt(
  slug: string,
  variables: Record<string, unknown>,
): Promise<RenderedPrompt> {
  // Load from bundled registry (use slug as-is — registry keys use '/' for categories)
  const template = PROMPT_REGISTRY[slug];

  if (!template) {
    const availablePrompts = Object.keys(PROMPT_REGISTRY).join(', ');
    throw new Error(
      `Prompt template not found: ${slug}\n\n` +
        `Available prompts: ${availablePrompts}\n\n` +
        `To add a new prompt:\n` +
        `1. Create the JSON file in packages/features/prompt-engine/src/prompts/<category>/\n` +
        `2. Add an import and registry entry in prompt-registry.ts`,
    );
  }

  assertPromptLlm(slug, template);

  // One renderer for both executors: an unfilled or undeclared
  // placeholder is an error, not a literal left in the text (KB-126)
  const { systemPrompt, userPrompt } = renderTemplate(
    slug,
    template,
    variables,
  );

  // Return rendered prompt
  return {
    systemPrompt,
    userPrompt,
    llmConfig: {
      provider: template.llm.provider,
      model: template.llm.model,
      temperature: template.llm.temperature,
      max_tokens: template.llm.max_tokens,
      response_format: template.llm.response_format,
    },
    output: template.output,
    version: template.version,
    slug: template.slug,
  };
}
