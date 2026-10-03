import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { loadAndRenderPrompt } from '../src/lib/server/prompt-loader';
import { PROMPT_REGISTRY } from '../src/lib/server/prompt-registry';
import type { PromptTemplate } from '../src/lib/types';

/**
 * Prompt Format Validation Tests
 *
 * Ensures all prompt JSON templates follow a single consistent format:
 * - Only {{variable}} interpolation (no Handlebars {{{triple}}}, {{#if}}, etc.)
 * - Valid LLM provider names (gemini, openai, anthropic, deepseek)
 * - Valid JSON with trailing newline
 * - Required fields present
 */

const PROMPTS_DIR = path.resolve(__dirname, '../src/prompts');

// All prompts standardized on Gemini as of FILM-1133 audit
const VALID_PROVIDERS = ['gemini'];

// Recursively find all .json files
function findJsonFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.name.endsWith('.json')) {
      results.push(fullPath);
    }
  }

  return results;
}

// Extract all prompt text fields from a template
// Handles two formats:
//   Standard: user_prompt, system_prompt, system_prompts[].content
//   Canon-role: userPrompt.template, systemPrompt.template
function extractPromptTexts(template: Record<string, unknown>): string[] {
  const texts: string[] = [];

  // Standard format
  if (typeof template.user_prompt === 'string') {
    texts.push(template.user_prompt);
  }

  if (typeof template.system_prompt === 'string') {
    texts.push(template.system_prompt);
  }

  if (Array.isArray(template.system_prompts)) {
    for (const sp of template.system_prompts) {
      if (
        typeof sp === 'object' &&
        sp !== null &&
        'content' in sp &&
        typeof sp.content === 'string'
      ) {
        texts.push(sp.content);
      }
    }
  }

  // Canon-role format (systemPrompt.template, userPrompt.template)
  const systemPrompt = template.systemPrompt as
    | Record<string, unknown>
    | undefined;
  if (systemPrompt && typeof systemPrompt.template === 'string') {
    texts.push(systemPrompt.template);
  }

  const userPrompt = template.userPrompt as Record<string, unknown> | undefined;
  if (userPrompt && typeof userPrompt.template === 'string') {
    texts.push(userPrompt.template);
  }

  return texts;
}

describe('Prompt Template Format Validation', () => {
  const jsonFiles = findJsonFiles(PROMPTS_DIR);

  it('should find prompt template files', () => {
    expect(jsonFiles.length).toBeGreaterThan(0);
  });

  describe.each(
    jsonFiles.map((f) => [path.relative(PROMPTS_DIR, f), f] as const),
  )('%s', (_relativePath, filePath) => {
    let content: string;
    let template: Record<string, unknown>;

    // Parse file in beforeAll so invalid JSON causes a clean test failure
    // with file name in output, rather than crashing the entire suite.
    beforeAll(() => {
      content = fs.readFileSync(filePath, 'utf-8');
      template = JSON.parse(content);
    });

    it('should be valid JSON', () => {
      expect(() => JSON.parse(content)).not.toThrow();
    });

    it('should end with a trailing newline', () => {
      expect(content.endsWith('\n')).toBe(true);
    });

    it('should not use triple-brace Handlebars syntax {{{var}}}', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{\{/);
      }
    });

    it('should not use Handlebars conditionals {{#if}}, {{/if}}, {{#each}}, etc.', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{#/);
        expect(text).not.toMatch(/\{\{\//);
      }
    });

    it('should not use Handlebars helpers {{else}}, {{> partial}}', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        expect(text).not.toMatch(/\{\{else\}\}/);
        expect(text).not.toMatch(/\{\{>/);
      }
    });

    it('should have a complete LLM/model configuration block', () => {
      const llm = template.llm as Record<string, unknown> | undefined;
      const model = template.model as Record<string, unknown> | undefined;

      // Every prompt MUST have either an `llm` or `model` block
      expect(llm !== undefined || model !== undefined).toBe(true);

      const config = llm ?? model!;

      // Validate all config fields in one pass with descriptive errors
      const errors: string[] = [];

      if (
        typeof config.provider !== 'string' ||
        !VALID_PROVIDERS.includes(config.provider as string)
      ) {
        errors.push(
          `provider must be one of ${VALID_PROVIDERS.join(', ')}, got '${String(config.provider)}'`,
        );
      }

      if (
        typeof config.model !== 'string' ||
        (config.model as string).length === 0
      ) {
        errors.push(
          `model must be a non-empty string, got '${String(config.model)}'`,
        );
      }

      const temp = config.temperature;
      if (typeof temp !== 'number' || temp < 0 || temp > 1) {
        errors.push(`temperature must be 0–1, got ${String(temp)}`);
      }

      // Enforce max_tokens exclusively — maxTokens is not allowed
      if ('maxTokens' in config) {
        errors.push(
          `use "max_tokens" instead of "maxTokens" (found in ${String(template.slug ?? template.id)})`,
        );
      }

      const maxTokens = config.max_tokens;
      if (typeof maxTokens !== 'number' || maxTokens <= 0) {
        errors.push(`max_tokens must be > 0, got ${String(maxTokens)}`);
      }

      expect(errors).toEqual([]);
    });

    it('should have the fields the loader reads: slug, system_prompts[], user_prompt, variables', () => {
      // KB-106. This used to accept a bare `system_prompt` string as a second
      // format, which the loader has never read: eight files in that format
      // threw on every call. The test now asks for exactly what
      // `loadAndRenderPrompt` uses, and the block below runs the loader too.
      expect(typeof template.slug).toBe('string');
      expect(typeof template.user_prompt).toBe('string');
      expect('system_prompt' in template).toBe(false);
      expect(Array.isArray(template.system_prompts)).toBe(true);
      expect((template.system_prompts as unknown[]).length).toBeGreaterThan(0);
      expect(typeof template.variables).toBe('object');
      expect(template.variables).not.toBeNull();
    });
    it('should only use {{variable}} format for interpolation in prompts', () => {
      const promptTexts = extractPromptTexts(template);

      for (const text of promptTexts) {
        // Find all {{ patterns and ensure they are simple {{variable_name}} format
        // Valid: {{variable}}, {{variable_name}}, {{variableName}}
        // Invalid: {{{triple}}}, {{#if}}, {{/if}}, {{> partial}}, {{else}}
        // NOTE: Dot-notation (e.g. {{object.property}}) is intentionally
        // unsupported — our interpolation uses simple string replacement.
        const allBracePatterns = text.match(/\{\{[^}]*\}\}/g) || [];

        for (const pattern of allBracePatterns) {
          // Each pattern should match {{simple_variable_name}}
          expect(pattern).toMatch(/^\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}$/);
        }
      }
    });
  });
});

/**
 * KB-106: the format test must not drift from the loader again, so it runs
 * the loader. Every registered prompt renders, with every variable it
 * declares, into a system prompt and a user prompt.
 */
describe('every registered prompt renders through the real loader', () => {
  it.each(Object.keys(PROMPT_REGISTRY))('%s', async (key) => {
    const template = PROMPT_REGISTRY[key]!;
    const variables = Object.fromEntries(
      Object.keys(template.variables).map((name) => [name, `value of ${name}`]),
    );

    const rendered = await loadAndRenderPrompt(key, variables);

    expect(rendered.systemPrompt.trim().length).toBeGreaterThan(0);
    expect(rendered.userPrompt.trim().length).toBeGreaterThan(0);
    for (const name of Object.keys(variables)) {
      expect(rendered.systemPrompt + rendered.userPrompt).not.toContain(
        `{{${name}}}`,
      );
    }
  });
});

/**
 * KB-106's sibling: a caller naming a slug no registry holds fails with
 * "Prompt template not found" on every call. Every literal `templateSlug`
 * must name a key in the registry of the executor that file uses - the
 * package's for `executeLLM`, the llm-worker's for `executeLLMForLambda`.
 */
describe('every templateSlug names a registered prompt', () => {
  const REPO = path.resolve(__dirname, '../../../..');
  const ROOTS = ['packages', 'apps/web'];
  const SKIP = new Set([
    'node_modules',
    '.next',
    '.turbo',
    'dist',
    'coverage',
    '__tests__',
  ]);
  // The llm-worker's registry lives in the gateway (FILM-1902 part B)
  const LAMBDA_REGISTRY = path.join(
    REPO,
    'packages/ai-gateway/src/prompts/lambda-registry.ts',
  );

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [full]
        : [];
    });
  }

  const lambdaKeys = new Set(
    [
      ...fs
        .readFileSync(LAMBDA_REGISTRY, 'utf-8')
        .split('PROMPT_REGISTRY')[1]!
        .matchAll(/^\s*'([^']+)':/gm),
    ].map((m) => m[1]!),
  );
  const packageKeys = new Set(Object.keys(PROMPT_REGISTRY));

  const calls = ROOTS.flatMap((root) => sources(path.join(REPO, root))).flatMap(
    (file) => {
      const source = fs.readFileSync(file, 'utf-8');
      const lambda = source.includes('executeLLMForLambda');
      // run.write() renders the brief's prompt with the Lambda registry
      const pkg =
        /\bexecuteLLM\b/.test(source) || /\brun\.write\(/.test(source);
      // Comment lines hold examples (`@example … templateSlug: '…'`), not calls.
      const code = source
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/)/.test(line))
        .join('\n');
      return [...code.matchAll(/templateSlug:\s*'([^']+)'/g)].map((m) => ({
        file: path.relative(REPO, file),
        slug: m[1]!,
        keys: new Set([
          ...(pkg ? packageKeys : []),
          ...(lambda ? lambdaKeys : []),
        ]),
      }));
    },
  );

  it('finds the callers, so an empty result means clean and not unread', () => {
    expect(lambdaKeys.size).toBeGreaterThan(10);
    expect(calls.length).toBeGreaterThan(20);
  });

  it('names no slug its executor cannot load', () => {
    const unregistered = calls
      .filter((call) => !call.keys.has(call.slug))
      .map((call) => `${call.file}: '${call.slug}'`);

    expect(unregistered).toEqual([]);
  });
});

/**
 * KB-107. `executeLLM` treats `output.wrapper_key` as the key of an array
 * and throws for anything else, while four prompts used it for an object
 * their callers read whole - no reply could satisfy both. A wrapper_key is
 * allowed only where the prompt's own Zod schema says that key is an array.
 */
describe('a wrapper_key names an array', () => {
  const wrapped = Object.entries(PROMPT_REGISTRY).filter(
    ([, template]) => template.output?.wrapper_key,
  );

  it('finds the prompts that use one', () => {
    expect(wrapped.length).toBeGreaterThan(0);
  });

  it.each(wrapped)('%s', (_key, template) => {
    const { wrapper_key: key, schema } = template.output!;

    expect(
      schema?.type,
      `${key}: a wrapper_key needs a Zod schema to check it against`,
    ).toBe('zod');

    const compiled = eval(`(function(z) { return ${schema!.definition}; })`)(
      z,
    ) as z.ZodTypeAny;
    const shape = (compiled as z.AnyZodObject).shape as Record<
      string,
      z.ZodTypeAny
    >;
    let field = shape[key!];
    while (field && !(field instanceof z.ZodArray) && 'unwrap' in field) {
      field = (field as z.ZodOptional<z.ZodTypeAny>).unwrap();
    }

    expect(field, `${key} is not an array in the schema`).toBeInstanceOf(
      z.ZodArray,
    );
  });
});

/**
 * KB-115, the other side of KB-107: a caller must read the shape its prompt
 * actually returns. The executors hand back the value under a `wrapper_key`
 * - the bare array - and otherwise the whole object, so a caller may read
 * only that object's top-level keys, and nothing at all off an array or a
 * string. Every call site with a literal slug is checked: each
 * `<result>.data.<field>` and each destructure straight off `<result>.data`.
 */
describe('every caller reads the shape its prompt returns', () => {
  const REPO = path.resolve(__dirname, '../../../..');
  const ROOTS = ['packages', 'apps/web'];
  const SKIP = new Set([
    'node_modules',
    '.next',
    '.turbo',
    'dist',
    'coverage',
    '__tests__',
  ]);
  const LAMBDA_REGISTRY_FILE = path.join(
    REPO,
    'packages/ai-gateway/src/prompts/lambda-registry.ts',
  );
  const PROMPTS_DIR = path.join(
    REPO,
    'packages/features/prompt-engine/src/prompts',
  );

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (SKIP.has(entry.name)) return [];
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sources(full);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [full]
        : [];
    });
  }

  /** The llm-worker's keys, mapped to the file each imports, read from its source. */
  function lambdaTemplates() {
    const source = fs.readFileSync(LAMBDA_REGISTRY_FILE, 'utf-8');
    const imports = new Map(
      [...source.matchAll(/^import (\w+) from '([^']+\.json)';/gm)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );
    const templates = new Map<string, PromptTemplate>();
    for (const m of source
      .split('PROMPT_REGISTRY')[1]!
      .matchAll(/^\s*'([^']+)':\s*(\w+) as/gm)) {
      const file = imports.get(m[2]!);
      if (file) {
        templates.set(
          m[1]!,
          JSON.parse(
            fs.readFileSync(
              // imported as @kit/prompt-engine/prompts/<path>
              path.join(
                PROMPTS_DIR,
                file.replace(/^@kit\/prompt-engine\/prompts\//, ''),
              ),
              'utf-8',
            ),
          ) as PromptTemplate,
        );
      }
    }
    return templates;
  }

  type Returned =
    | { kind: 'string' }
    | { kind: 'array' }
    | { kind: 'object'; keys: string[] }
    | { kind: 'unknown' };

  /** The top-level keys a human-readable `schema_for_llm` describes. */
  function keysOfSchemaText(text: string) {
    const keys: string[] = [];
    let depth = 0;
    let token = '';
    for (const char of text) {
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') depth--;
      else if (depth === 1 && char === ':') {
        const key = /["']?(\w+)["']?\s*$/.exec(token)?.[1];
        if (key) keys.push(key);
      }
      token = char === ',' || char === '{' ? '' : token + char;
    }
    return keys;
  }

  function returnedBy(template: PromptTemplate): Returned {
    const output = template.output;
    if (output?.type === 'text') return { kind: 'string' };
    if (output?.wrapper_key) return { kind: 'array' };

    const schema = output?.schema as
      | { type?: string; definition?: string; properties?: object }
      | undefined;
    if (schema?.type === 'zod') {
      const compiled = eval(`(function(z) { return ${schema.definition}; })`)(
        z,
      ) as z.ZodTypeAny;
      return compiled instanceof z.ZodObject
        ? { kind: 'object', keys: Object.keys(compiled.shape as object) }
        : { kind: 'array' };
    }
    if (schema?.properties)
      return { kind: 'object', keys: Object.keys(schema.properties) };
    if (output?.schema_for_llm)
      return { kind: 'object', keys: keysOfSchemaText(output.schema_for_llm) };
    return { kind: 'unknown' };
  }

  const lambda = lambdaTemplates();
  const CALL =
    /(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*await\s+(executeLLM(?:ForLambda)?)\s*(?:<[\s\S]*?>)?\(\s*\{([\s\S]*?)\}\s*\)/g;

  const calls = ROOTS.flatMap((root) => sources(path.join(REPO, root))).flatMap(
    (file) => {
      const source = fs
        .readFileSync(file, 'utf-8')
        .split('\n')
        .filter((line) => !/^\s*(\*|\/\/)/.test(line))
        .join('\n');

      return [...source.matchAll(CALL)].flatMap((m) => {
        const slug = /templateSlug:\s*'([^']+)'/.exec(m[3]!)?.[1];
        if (!slug) return [];
        const template =
          m[2] === 'executeLLMForLambda'
            ? lambda.get(slug)
            : PROMPT_REGISTRY[slug];
        if (!template) return [];

        const variable = m[1]!;
        const fields = [
          ...[
            ...source.matchAll(
              new RegExp(`\\b${variable}\\.data(?:\\?\\.|\\.)(\\w+)`, 'g'),
            ),
          ].map((r) => r[1]!),
          ...[
            ...source.matchAll(
              new RegExp(
                `\\{([^{}]*)\\}\\s*=\\s*${variable}\\.data(?![.?\\w])`,
                'g',
              ),
            ),
          ].flatMap((r) =>
            r[1]!
              .split(',')
              .map((part) => part.trim().split(/[:=\s]/)[0]!)
              .filter(Boolean),
          ),
        ];

        return [
          {
            file: path.relative(REPO, file),
            slug,
            returned: returnedBy(template),
            fields: [...new Set(fields)],
          },
        ];
      });
    },
  );

  const ARRAY_OR_STRING_MEMBERS = new Set([
    'length',
    'map',
    'filter',
    'forEach',
    'slice',
    'some',
    'every',
    'find',
    'reduce',
    'join',
    'split',
    'trim',
    'includes',
  ]);

  /**
   * Readings that are wrong today and recorded, each with its KB. When one is
   * fixed, this fails until the entry goes.
   */
  const KNOWN_WRONG_READS: Record<string, string> = {};

  function wrongReads() {
    return calls.flatMap((call) => {
      const { returned } = call;
      const wrong =
        returned.kind === 'object'
          ? call.fields.filter((f) => !returned.keys.includes(f))
          : returned.kind === 'array' || returned.kind === 'string'
            ? call.fields.filter((f) => !ARRAY_OR_STRING_MEMBERS.has(f))
            : [];
      return wrong.length > 0
        ? [
            `${call.file}: ${call.slug} returns ${returned.kind === 'object' ? `{ ${returned.keys.join(', ')} }` : `a bare ${returned.kind}`}, read as .${wrong.join(', .')}`,
          ]
        : [];
    });
  }

  it('finds the callers and knows what each prompt returns', () => {
    // 24 on 2026-10-03: #554 deleted the uncalled news-service and
    // act-context-bridge callers; #557/#560 moved five into @kit/generation's
    // stages, which render through buildBrief rather than executeLLM.
    expect(calls.length).toBeGreaterThan(20);
    expect(
      calls
        .filter((c) => c.returned.kind === 'unknown')
        .map((c) => `${c.file}: ${c.slug}`),
    ).toEqual([]);
  });

  it('reads nothing the prompt does not return', () => {
    const unexpected = wrongReads().filter(
      (line) =>
        !Object.keys(KNOWN_WRONG_READS).some((known) => line.startsWith(known)),
    );
    expect(unexpected).toEqual([]);
  });

  it('still finds each recorded wrong read, until its KB is fixed', () => {
    const found = wrongReads();
    const stale = Object.entries(KNOWN_WRONG_READS)
      .filter(([known]) => !found.some((line) => line.startsWith(known)))
      .map(([known, kb]) => `${kb}: ${known}`);
    expect(
      stale,
      'fixed? remove it from KNOWN_WRONG_READS and mark the KB',
    ).toEqual([]);
  });
});
