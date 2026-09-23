/**
 * A library, not a `'use server'` module (KB-58): every export of one of
 * those is an endpoint anyone can call. No `server-only` either: the LLM
 * worker Lambda imports this, and `server-only` throws outside Next.
 */

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

  // Validate required variables are provided
  const missingVars: string[] = [];
  for (const [varName, varDef] of Object.entries(template.variables)) {
    if (varDef.required && !(varName in variables)) {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required variables for prompt ${slug}: ${missingVars.join(', ')}`,
    );
  }

  // Interpolate variables in user prompt
  const userPrompt = interpolateVariables(template.user_prompt, variables);

  // Compose system prompts (sort by order, interpolate variables, then concatenate)
  const systemPrompt = template.system_prompts
    .sort((a, b) => a.order - b.order)
    .map((sp) => interpolateVariables(sp.content, variables))
    .join('\n\n');

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

/**
 * Interpolate variables into template string
 * Replaces {{variable_name}} with actual values
 *
 * @param template - Template string with {{variable}} placeholders
 * @param variables - Object with variable values
 * @returns String with variables replaced
 */
function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{{${key}}}`;
    const replacement = String(value);
    result = result.replaceAll(placeholder, replacement);
  }

  return result;
}
