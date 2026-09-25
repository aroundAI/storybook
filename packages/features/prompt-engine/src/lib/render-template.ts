/**
 * The one way a prompt template becomes the text a model is sent — used by
 * prompt-engine's `loadAndRenderPrompt` and the LLM worker's
 * `loadAndRenderPromptForLambda` alike.
 *
 * They used to differ where it mattered: prompt-engine left a placeholder
 * nobody filled in the text (the model was sent `{{characters}}`), and the
 * worker blanked it (the data vanished without a trace). Both hid a caller
 * that sent its data under the wrong name (KB-126). Now a placeholder with
 * no value and no default is an error, and so is one the template does not
 * declare. `prompt-variables.test.ts` checks every call site statically.
 *
 * Pure, and free of `server-only`: the worker imports it.
 */

export interface RenderableTemplate {
  user_prompt?: string;
  system_prompts?: ReadonlyArray<{ content: string; order?: number }>;
  /** Legacy single system prompt */
  system_prompt?: string;
  variables?: Record<string, { required?: boolean; default?: unknown }>;
}

export class PromptTemplateError extends Error {
  override readonly name = 'PromptTemplateError';
}

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function provided(value: unknown): boolean {
  return value !== undefined && value !== null;
}

export function renderTemplate(
  slug: string,
  template: RenderableTemplate,
  variables: Record<string, unknown>,
): { systemPrompt: string; userPrompt: string } {
  const declared = template.variables ?? {};

  const missing = Object.entries(declared)
    .filter(([name, spec]) => spec.required && !provided(variables[name]))
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new PromptTemplateError(
      `Missing required variables for prompt ${slug}: ${missing.join(', ')}`,
    );
  }

  const unfilled = new Set<string>();
  const undeclared = new Set<string>();

  // One pass per text: a value that itself contains `{{x}}` is not expanded
  const fill = (text: string) =>
    text.replace(PLACEHOLDER, (match, name: string) => {
      const spec = declared[name];

      if (!spec) {
        undeclared.add(name);
        return match;
      }

      if (provided(variables[name])) return String(variables[name]);
      if (spec.default !== undefined) return String(spec.default);

      unfilled.add(name);
      return match;
    });

  const systemPrompt = template.system_prompts
    ? [...template.system_prompts]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((part) => fill(part.content))
        .join('\n\n')
    : fill(template.system_prompt ?? '');

  const userPrompt = fill(template.user_prompt ?? '');

  if (unfilled.size > 0 || undeclared.size > 0) {
    const list = (names: Set<string>) =>
      [...names].map((name) => `{{${name}}}`).join(', ');

    throw new PromptTemplateError(
      [
        `Prompt ${slug} cannot be rendered:`,
        unfilled.size > 0 ? `unfilled ${list(unfilled)}` : '',
        undeclared.size > 0 ? `undeclared ${list(undeclared)}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  return { systemPrompt, userPrompt };
}
