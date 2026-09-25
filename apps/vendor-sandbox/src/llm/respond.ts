import type { z } from 'zod';

import type { Rng } from '../rng';
import { type Quality, createContext } from './generate/context';
import {
  type JsonSchema,
  generateFromJsonSchema,
} from './generate/json-schema';
import {
  TEMPLATE_SCHEMAS,
  TEXT_TEMPLATES,
  generateTemplate,
} from './generate/templates';
import { compileZodDefinition, generateFromZod } from './generate/zod';
import { type CatalogPrompt, matches } from './prompts';

export type Identified =
  | { kind: 'prompt'; key: string }
  | { kind: 'unrecognised' };

/**
 * Which prompt a request is, from its system prompt: the one whose literal
 * fragments all appear. When more than one does, the one that
 * accounts for the most text wins (the identify test asserts that never
 * happens for the checked-in prompts).
 */
export function identify(
  systemPrompt: string,
  catalog: readonly CatalogPrompt[],
): Identified {
  const candidates = catalog
    .filter((prompt) => matches(systemPrompt, prompt.fragments))
    .map((prompt) => ({
      key: prompt.key,
      weight: prompt.fragments.flat().reduce((sum, f) => sum + f.length, 0),
    }))
    .sort((a, b) => b.weight - a.weight);

  const best = candidates[0];
  return best ? { kind: 'prompt', key: best.key } : { kind: 'unrecognised' };
}

/** How a prompt's output is produced. Every prompt must have exactly one. */
export type GeneratorKind = 'zod' | 'json-schema' | 'template';

export function generatorKindOf(prompt: CatalogPrompt): GeneratorKind | null {
  if (prompt.key in TEXT_TEMPLATES || prompt.key in TEMPLATE_SCHEMAS)
    return 'template';
  const schema = prompt.template.output?.schema as
    | { type?: unknown }
    | undefined;
  if (schema?.type === 'zod') return 'zod';
  if (schema && typeof schema === 'object') return 'json-schema';
  return null;
}

const compiled = new Map<string, z.ZodTypeAny>();

function zodSchemaOf(prompt: CatalogPrompt) {
  const definition = (prompt.template.output?.schema as { definition: string })
    .definition;
  let schema = compiled.get(definition);
  if (!schema) {
    schema = compileZodDefinition(definition);
    compiled.set(definition, schema);
  }
  return schema;
}

export interface PromptResponse {
  text: string;
  unplaced: string[];
}

/**
 * The model's reply to one recognised prompt: the right shape for that
 * prompt, realistic words from the corpus. A Zod prompt's output is checked
 * against its own schema here as well, so a generator bug fails in the
 * sandbox, loudly, rather than in the app.
 */
export function respondToPrompt(
  prompt: CatalogPrompt,
  userPrompt: string,
  rng: Rng,
  quality: Quality = 'high',
): PromptResponse {
  const ctx = createContext(rng, userPrompt, quality);
  const kind = generatorKindOf(prompt);

  let value: unknown;
  switch (kind) {
    case 'template':
      value = generateTemplate(prompt.key, userPrompt, ctx);
      break;
    case 'zod': {
      const schema = zodSchemaOf(prompt);
      value = generateFromZod(schema, ctx);
      const checked = schema.safeParse(value);
      if (!checked.success) {
        throw new Error(
          `vendor-sandbox: generated output for ${prompt.key} fails its own schema: ${checked.error.message}`,
        );
      }
      break;
    }
    case 'json-schema':
      value = generateFromJsonSchema(
        prompt.template.output?.schema as JsonSchema,
        ctx,
      );
      break;
    default:
      throw new Error(`vendor-sandbox: no generator for prompt ${prompt.key}`);
  }

  const text =
    typeof value === 'string'
      ? value
      : rng.chance(0.3)
        ? `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``
        : JSON.stringify(value, null, 2);

  return { text, unplaced: [...ctx.unplaced] };
}

/**
 * The answer to a request nobody recognises. It is still answered - a
 * crashed sandbox helps nobody - but with nothing a caller could mistake
 * for real output, and the ledger flags it.
 */
export const UNRECOGNISED_RESPONSE = '{}';
