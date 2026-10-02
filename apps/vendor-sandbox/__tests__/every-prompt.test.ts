import Ajv from 'ajv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PROMPT_REGISTRY } from '@kit/prompt-engine/prompt-registry';

import { TEMPLATE_SCHEMAS } from '../src/llm/generate/templates';
import { compileZodDefinition } from '../src/llm/generate/zod';
import { type CatalogPrompt, loadCatalog } from '../src/llm/prompts';
import { generatorKindOf } from '../src/llm/respond';
import {
  type Sandbox,
  guardEgress,
  startSandbox,
  variablesFor,
} from './helpers';

/**
 * FILM-1803 §7: every prompt the app has gets a sandbox response that goes
 * through the app's own parsing and validation and comes out the other side.
 *
 * Nothing between the prompt and the sandbox is mocked. The real executors
 * render the real prompt files, build the real Gemini client (reaching the
 * sandbox through VENDOR_URL_GEMINI, FILM-1805), send it over HTTP, and
 * parse the reply exactly as they do in production. Only usage logging -
 * a Supabase write - is stubbed. Two executors exist and both are run:
 *
 * - `executeLLM` (`@kit/prompt-engine`), for the 29 prompts in its registry;
 * - `executeLLMForLambda` (the llm-worker), where every studio stage runs.
 *   It never validates against a prompt's Zod schema, so this test does,
 *   with the executor's own compile.
 */

vi.mock('@kit/supabase/lambda-admin-client', () => ({
  createLambdaAdminClient: () => ({
    from: () => ({ insert: async () => ({ data: null, error: null }) }),
  }),
}));

/**
 * Prompts the app cannot use today, whatever the model returns. Each names
 * its known bug and the exact error. When one starts passing, this test
 * fails: take it out of the list and mark the KB fixed.
 */
const KNOWN_BROKEN: Record<string, { kb: string; error: RegExp }> = {};

const ajv = new Ajv({ allErrors: true, strict: false });

let sandbox: Sandbox;
let refused: string[];
const catalog = loadCatalog();

beforeAll(async () => {
  sandbox = await startSandbox();
  refused = guardEgress();
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await sandbox.close();
});

function lastLedgerEntry() {
  return sandbox.state.ledger.list({ vendor: 'gemini' })[0];
}

function variableNames(prompt: CatalogPrompt) {
  return Object.keys(prompt.template.variables ?? {});
}

/** The shape a caller reads, checked with the rule that applies to it. */
function assertShape(prompt: CatalogPrompt, data: unknown, full: unknown) {
  const kind = generatorKindOf(prompt);
  const schema = prompt.template.output?.schema as
    | { type?: string; definition?: string }
    | undefined;

  if (kind === 'zod') {
    compileZodDefinition(schema!.definition!).parse(full);
  } else if (kind === 'json-schema') {
    const validate = ajv.compile(schema as object);
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  } else if (prompt.key === 'dialogue-translation') {
    expect(typeof data).toBe('string');
    const lines = (data as string).split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);
    for (const line of lines) expect(line).toMatch(/^\d+\. \[[a-z]+\] \S/);
  } else {
    TEMPLATE_SCHEMAS[prompt.key]!.parse(full);
  }
}

describe('the catalog', () => {
  it('holds every prompt file, each with a generator', () => {
    // 31 until FILM-717 removed a publishing prompt.
    expect(catalog).toHaveLength(30);
    for (const prompt of catalog) {
      expect(generatorKindOf(prompt), prompt.key).not.toBeNull();
    }
  });
});

describe('through executeLLM (@kit/prompt-engine)', async () => {
  const { executeLLM } = await import('@kit/prompt-engine/server');
  const registered = catalog.filter((p) => p.key in PROMPT_REGISTRY);

  it('covers the whole package registry', () => {
    expect(registered.map((p) => p.key).sort()).toEqual(
      Object.keys(PROMPT_REGISTRY).sort(),
    );
  });

  it.each(registered.map((p) => [p.key, p] as const))(
    '%s',
    async (key, prompt) => {
      const run = executeLLM({
        templateSlug: key,
        variables: variablesFor(variableNames(prompt)),
        context: {
          name: `sandbox.${key}`,
          accountId: '18030000-0000-4000-8000-000000000001',
        },
      });

      const broken = KNOWN_BROKEN[key];
      if (broken) {
        await expect(
          run,
          `${key} is listed as ${broken.kb} but did not fail as recorded - if the KB is fixed, remove it from KNOWN_BROKEN and mark it fixed`,
        ).rejects.toThrow(broken.error);
        return;
      }

      const result = await run;
      const entry = lastLedgerEntry();
      expect(entry?.identified).toEqual({ kind: 'prompt', key });

      const wrapper = prompt.template.output?.wrapper_key;
      assertShape(
        prompt,
        result.data,
        wrapper ? { [wrapper]: result.data } : result.data,
      );
      expect(refused).toEqual([]);
    },
  );
});

describe('through executeLLMForLambda (the llm-worker)', async () => {
  const { executeLLMForLambda } = await import(
    '../../web/lambda/llm-worker/llm-utils'
  );
  const { PROMPT_REGISTRY: LAMBDA_REGISTRY } = await import(
    '../../web/lambda/llm-worker/prompt-registry'
  );

  // One run per distinct prompt, under the first key that names it.
  const seen = new Set<unknown>();
  const lambdaPrompts = Object.entries(LAMBDA_REGISTRY).filter(
    ([, template]) => {
      if (seen.has(template)) return false;
      seen.add(template);
      return true;
    },
  );

  it.each(lambdaPrompts)('%s', async (key, template) => {
    const prompt = catalog.find(
      (p) => JSON.stringify(p.template) === JSON.stringify(template),
    );
    expect(prompt, `${key} is not in the sandbox catalog`).toBeDefined();

    const result = await executeLLMForLambda({
      templateSlug: key,
      variables: variablesFor(Object.keys(template.variables ?? {})),
    });

    expect(lastLedgerEntry()?.identified).toEqual({
      kind: 'prompt',
      key: prompt!.key,
    });

    const wrapper = template.output?.wrapper_key;
    assertShape(
      prompt!,
      result.data,
      wrapper ? { [wrapper]: result.data } : result.data,
    );
    expect(refused).toEqual([]);
  });
});
