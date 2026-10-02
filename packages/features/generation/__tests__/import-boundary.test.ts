import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1901: `@kit/generation` decides what to ask for and what to save,
 * never who writes. So it imports no model: not `@kit/llm`, not
 * `@kit/agent`, not a provider SDK, and from `@kit/prompt-engine` only the
 * pure subpaths (`@kit/prompt-engine` itself depends on `@kit/llm`; its
 * `/server` entry is the executor). It is also esbuild-bundled into the LLM
 * worker, so no `server-only`, no Next imports and no `@kit/episodes`
 * (whose `/server` entry the worker cannot import, and which depends on
 * this package).
 */

const PACKAGE = resolve(__dirname, '..');
const SRC = join(PACKAGE, 'src');
const SOURCE = /\.(?:ts|tsx)$/;

const FORBIDDEN: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /^@kit\/llm(?:\/|$)/, why: 'a model client' },
  { pattern: /^@kit\/agent(?:\/|$)/, why: 'the agent runner calls a model' },
  { pattern: /^@kit\/ai-gateway(?:\/|$)/, why: 'the gateway is the caller' },
  { pattern: /^@kit\/episodes(?:\/|$)/, why: 'depends on this package' },
  { pattern: /^@kit\/prompt-engine\/server$/, why: 'the executor' },
  { pattern: /^@kit\/prompt-engine$/, why: 'no root entry; use a subpath' },
  { pattern: /^@kit\/prompt-engine\/prompt-registry$/, why: 'server-only' },
  { pattern: /^@google\/genai(?:\/|$)/, why: 'a model SDK' },
  { pattern: /^openai(?:\/|$)/, why: 'a model SDK' },
  { pattern: /^@anthropic-ai\//, why: 'a model SDK' },
  { pattern: /^voyageai(?:\/|$)/, why: 'an embedding SDK' },
  { pattern: /^server-only$/, why: 'the worker bundle has no Next runtime' },
  { pattern: /^next(?:\/|$)/, why: 'the worker bundle has no Next runtime' },
];

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) {
      return entry === 'node_modules' ? [] : sourceFiles(path);
    }

    return SOURCE.test(entry) ? [path] : [];
  });
}

export function forbiddenImports(root = SRC) {
  return sourceFiles(root).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const name = relative(PACKAGE, file).split(sep).join('/');

    return [...source.matchAll(IMPORT)]
      .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
      .flatMap((specifier) => {
        const hit = FORBIDDEN.find(({ pattern }) => pattern.test(specifier));
        return hit ? [`${name} imports ${specifier} (${hit.why})`] : [];
      });
  });
}

describe('@kit/generation reaches no model (FILM-1901)', () => {
  it('scans the package source', () => {
    const files = sourceFiles(SRC).map((f) => relative(PACKAGE, f));

    expect(files).toContain(join('src', 'types.ts'));
    expect(files).toContain(join('src', 'brief.ts'));
    expect(files.length).toBeGreaterThan(5);
  });

  it('recognises every forbidden shape', () => {
    const planted = [
      `import { createLLMClient } from '@kit/llm';`,
      `import { executeLLM } from '@kit/prompt-engine/server';`,
      `const { runAgent } = await import('@kit/agent');`,
      `import 'server-only';`,
      `import { GoogleGenAI } from '@google/genai';`,
      `import { revalidatePath } from 'next/cache';`,
    ];

    for (const line of planted) {
      const specifier = [...line.matchAll(IMPORT)].map(
        (m) => m[1] ?? m[2] ?? m[3] ?? m[4],
      );
      expect(specifier, line).toHaveLength(1);
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(specifier[0] ?? '')),
        line,
      ).toBe(true);
    }

    // And allows the subpaths this package is built on
    for (const ok of [
      '@kit/prompt-engine/render-template',
      '@kit/prompt-engine/schemas',
      '@kit/prompt-engine/prompts/story-generation/story-refinement.json',
      '@kit/shared/prompt-sanitiser',
      '@kit/supabase/database',
      'zod-to-json-schema',
    ]) {
      expect(
        FORBIDDEN.some(({ pattern }) => pattern.test(ok)),
        ok,
      ).toBe(false);
    }
  });

  it('imports nothing from @kit/llm, @kit/agent, a model SDK, Next or @kit/episodes', () => {
    expect(forbiddenImports()).toEqual([]);
  });
});
