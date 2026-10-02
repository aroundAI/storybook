import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1902 criterion 1 and 3, the build-time half that lint cannot see:
 * `@kit/ai-gateway` is the only workspace package that depends on
 * `@kit/llm`, `@google/genai`, `openai`, `@anthropic-ai/sdk` or the Voyage
 * client, and no source file outside it imports one. ESLint's
 * `no-restricted-imports` (tooling/eslint/model-boundary.js) refuses the
 * import where it is written; this scan refuses the dependency where it is
 * declared, and reads every source file once more so a package whose lint
 * config was changed is still caught. It runs in the fast lane with the
 * unit tests, which is where a dependency-cruiser step would have run: the
 * repo's precedent for this kind of rule is a source scan
 * (packages/llm/__tests__/sdk-base-url-guard.test.ts, model-host-guard), and
 * one more tool in CI for one rule bought nothing the scan does not.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  '.open-next',
  '.sst',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
]);
const SOURCE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE =
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$|vitest\.(?:config|setup)\.[jt]s$/;

export const MODEL_PACKAGES = [
  '@kit/llm',
  '@google/genai',
  'openai',
  '@anthropic-ai/sdk',
  'voyageai',
];

/** The door: where the model packages may be depended on and imported. */
export const GATEWAY_PACKAGES = ['packages/ai-gateway', 'packages/llm'];

/**
 * Dev-only exceptions, each with the reason. The vendor sandbox is the
 * FILM-1803 stand-in for the vendors' APIs; its tests drive the real SDK
 * clients at it, so it needs the client package to test with. It is never
 * deployed and generates nothing for a user.
 */
export const DEV_DEPENDENCY_EXCEPTIONS: Record<string, string> = {
  'apps/vendor-sandbox':
    'the vendor stand-in (FILM-1803): its tests drive the real clients at it',
};

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }

  return out;
}

const FILES = ROOTS.flatMap((root) => walk(join(REPO, root))).map((file) =>
  relative(REPO, file).split(sep).join('/'),
);

function packageDir(file: string) {
  return file.split('/').slice(0, 2).join('/');
}

export function isModelPackage(specifier: string) {
  return MODEL_PACKAGES.some(
    (name) => specifier === name || specifier.startsWith(`${name}/`),
  );
}

export function isGatewayFile(file: string) {
  return GATEWAY_PACKAGES.some((dir) => file.startsWith(`${dir}/`));
}

/** The model packages `manifest` (a package.json) depends on, by section. */
export function modelDependencies(manifest: string, source: string) {
  const parsed = JSON.parse(source) as Record<
    string,
    Record<string, string> | undefined
  >;
  const found: string[] = [];

  for (const section of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    for (const name of Object.keys(parsed[section] ?? {})) {
      if (!isModelPackage(name)) continue;

      const dir = packageDir(manifest);

      if (GATEWAY_PACKAGES.includes(dir)) continue;

      if (section === 'devDependencies' && dir in DEV_DEPENDENCY_EXCEPTIONS) {
        continue;
      }

      found.push(`${manifest} ${section} ${name}`);
    }
  }

  return found;
}

/** Every import of a model package in `source`, as if it were `file`. */
export function modelImports(file: string, source: string) {
  if (isGatewayFile(file)) return [];

  return [...source.matchAll(IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? '')
    .filter(isModelPackage)
    .map(
      (specifier) =>
        `${file} imports ${specifier}: a model is reached only through @kit/ai-gateway (FILM-1902)`,
    );
}

function read(file: string) {
  return readFileSync(join(REPO, file), 'utf8');
}

describe('@kit/ai-gateway is the only package that reaches a model (FILM-1902)', () => {
  const manifests = FILES.filter((file) => file.endsWith('/package.json'));
  const sources = FILES.filter(
    (file) => SOURCE.test(file) && !TEST_FILE.test(file),
  );

  it('scans the workspace it claims to', () => {
    expect(manifests.length).toBeGreaterThan(30);
    expect(manifests).toContain('packages/ai-gateway/package.json');
    expect(manifests).toContain('packages/features/episodes/package.json');
    expect(sources).toContain(
      'packages/ai-gateway/src/executors/model-client.ts',
    );
    expect(sources).toContain(
      'packages/features/episodes/src/server/story-actions.ts',
    );
    expect(sources).not.toContain(
      'packages/ai-gateway/__tests__/model-boundary.test.ts',
    );
  });

  it('the gateway itself depends on the model packages, so an empty result means clean', () => {
    const gateway = JSON.parse(read('packages/ai-gateway/package.json')) as {
      dependencies: Record<string, string>;
    };

    expect(gateway.dependencies['@kit/llm']).toBeDefined();
    expect(
      modelImports(
        'packages/features/episodes/src/x.ts',
        read('packages/ai-gateway/src/executors/model-client.ts'),
      ),
    ).not.toEqual([]);
  });

  it('no other package.json depends on @kit/llm or a model SDK', () => {
    const violations = manifests.flatMap((manifest) =>
      modelDependencies(manifest, read(manifest)),
    );

    expect(violations).toEqual([]);
  });

  it('no source file outside the gateway imports @kit/llm or a model SDK', () => {
    const violations = sources.flatMap((file) =>
      modelImports(file, read(file)),
    );

    expect(violations).toEqual([]);
  });

  it.each([
    `import { createLLMClient } from '@kit/llm';`,
    `import type { LLMProvider } from '@kit/llm/types';`,
    `const { GoogleGenAI } = await import('@google/genai');`,
    `import OpenAI from 'openai';`,
    `import Anthropic from '@anthropic-ai/sdk';`,
    `const voyage = require('voyageai');`,
  ])('fails on %s in a feature package', (line) => {
    expect(
      modelImports('packages/features/episodes/src/call.ts', line),
    ).toHaveLength(1);
    expect(modelImports('packages/ai-gateway/src/call.ts', line)).toEqual([]);
  });

  it.each([
    `import { openRun } from '@kit/ai-gateway';`,
    `import { PROMPT_REGISTRY } from '@kit/ai-gateway/lambda-prompts';`,
    `const provider = 'openai';`,
    `import { openaiPricing } from './openai-pricing';`,
  ])('passes %s, which reaches no model', (line) => {
    expect(
      modelImports('packages/features/episodes/src/call.ts', line),
    ).toEqual([]);
  });

  it('refuses a dependency, allows the sandbox dev dependency, and the gateway', () => {
    const manifest = (deps: object, section = 'dependencies') =>
      JSON.stringify({ name: 'x', [section]: deps });

    expect(
      modelDependencies(
        'packages/features/episodes/package.json',
        manifest({ '@kit/llm': 'workspace:*' }),
      ),
    ).toEqual([
      'packages/features/episodes/package.json dependencies @kit/llm',
    ]);
    expect(
      modelDependencies(
        'apps/vendor-sandbox/package.json',
        manifest({ '@kit/llm': 'workspace:*' }, 'devDependencies'),
      ),
    ).toEqual([]);
    expect(
      modelDependencies(
        'apps/vendor-sandbox/package.json',
        manifest({ '@kit/llm': 'workspace:*' }),
      ),
    ).toHaveLength(1);
    expect(
      modelDependencies(
        'packages/ai-gateway/package.json',
        manifest({ openai: '^4' }),
      ),
    ).toEqual([]);
  });
});
