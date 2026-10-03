import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROMPT_REGISTRY } from '@kit/prompt-engine/prompt-registry';
import type { PromptTemplate } from '@kit/prompt-engine/types';

/**
 * The prompts the app sends. Two registries read the same files: the
 * package's (`@kit/prompt-engine/prompt-registry`, used by `executeLLM`) and
 * the gateway's Lambda registry (`packages/ai-gateway/src/prompts/lambda-registry.ts`,
 * used by `executeLLMForLambda`), which also carries the two refinement prompts. So the catalog is the
 * package registry plus every prompt file on disk it does not hold, keyed as
 * the Lambda keys them (their `slug`). Nothing is restated.
 */

/** What both executors append when a prompt has `schema_for_llm`. */
export const SCHEMA_FOR_LLM_HEADER = '\n\n**Expected Output Schema:**\n';

export const PROMPTS_DIR = fileURLToPath(
  new URL(
    '../../../../packages/features/prompt-engine/src/prompts/',
    import.meta.url,
  ),
);

/** Fragments shorter than this are too generic to identify a prompt by. */
const MIN_FRAGMENT = 12;

type AnyTemplate = PromptTemplate & { system_prompt?: string };

export interface CatalogPrompt {
  /** The key a caller passes as `templateSlug`. */
  key: string;
  /** The file it comes from, relative to the prompts directory. */
  file: string;
  template: AnyTemplate;
  /**
   * The literal text between variables, one group per system-prompt part
   * (and one for `schema_for_llm`). Within a group the order is fixed; the
   * groups may come in any order, because the package loader sorts parts by
   * `order` and the Lambda's renderer does not.
   */
  fragments: string[][];
}

export function fragmentsOf(text: string) {
  return text
    .split(/\{\{[^}]*\}\}/)
    .map((part) => part.trim())
    .filter((part) => part.length >= MIN_FRAGMENT);
}

/**
 * `system_prompts[]` is what the package loader reads; eight files use a bare
 * `system_prompt` string instead, which only the Lambda's renderer handles
 * (KB-106). Both are recognised, so a prompt is answered the same way before
 * and after its file is fixed.
 */
function partsOf(template: AnyTemplate) {
  const parts = Array.isArray(template.system_prompts)
    ? template.system_prompts.map((part) => part.content)
    : [template.system_prompt ?? ''];
  const schema = template.output?.schema_for_llm;
  return schema ? [...parts, schema] : parts;
}

function promptFiles(dir = PROMPTS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? promptFiles(join(dir, entry.name))
      : entry.name.endsWith('.json')
        ? [join(dir, entry.name)]
        : [],
  );
}

export function loadCatalog(): CatalogPrompt[] {
  const files = promptFiles().map((path) => ({
    file: relative(PROMPTS_DIR, path),
    template: JSON.parse(readFileSync(path, 'utf8')) as AnyTemplate,
  }));

  const byContent = new Map(
    files.map((f) => [JSON.stringify(f.template), f.file]),
  );

  const registered = Object.entries(PROMPT_REGISTRY).map(([key, template]) => ({
    key,
    file: byContent.get(JSON.stringify(template)) ?? '(not on disk)',
    template: template as AnyTemplate,
  }));
  const registeredFiles = new Set(registered.map((p) => p.file));

  const lambdaOnly = files
    .filter((f) => !registeredFiles.has(f.file))
    .map((f) => ({ key: f.template.slug, file: f.file, template: f.template }));

  return [...registered, ...lambdaOnly].map((prompt) => ({
    ...prompt,
    fragments: partsOf(prompt.template)
      .map(fragmentsOf)
      .filter((group) => group.length > 0),
  }));
}

/** Every group's fragments appear in `text`, each group in its own order. */
export function matches(text: string, groups: readonly string[][]) {
  if (groups.length === 0) return false;

  return groups.every((group) => {
    let from = 0;
    for (const fragment of group) {
      const at = text.indexOf(fragment, from);
      if (at < 0) return false;
      from = at + fragment.length;
    }
    return true;
  });
}
