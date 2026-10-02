import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { VENDORS, type Vendor } from '@kit/shared/vendors';

/**
 * FILM-1902. A model is reached through the gateway and nowhere else. Every
 * model host lives in `packages/shared/src/vendors/resolver.ts` and is
 * reached by `vendorUrl(...)`, so a new call site has two spellings and this
 * scan knows both: the host written out, and the resolver asked for a model
 * vendor by name. Either one outside the allowlist fails the fast lane,
 * naming the file and line.
 *
 * The allowlist is the gateway and what it will absorb: `packages/llm` is
 * today's door (part B narrows its exports), `packages/ai-gateway` is the
 * package part B adds, the vendors directory declares the hosts, and the
 * sandbox serves them. Two files are allowed by name, each with the reason:
 *
 * - `api-keys-actions.ts` validates a user's own BYOK key against the
 *   vendor's model-list endpoint. It generates nothing and sends no prompt,
 *   so it is not a model call; it stays as it is.
 * - `voyage-embedder.ts` is the worker's embedding call. It moves behind the
 *   gateway in FILM-1902 part B, and its entry goes with it.
 *
 * `sdk-base-url-guard.test.ts` makes sure every SDK is given a host; this
 * makes sure only the gateway asks for one.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps', 'sst.config.ts'];
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
  /(?:^|\/)(?:__tests__|__mocks__|e2e)\/|\.(?:test|spec)\.[jt]sx?$/;

/** Directories that may reach a model host: the gateway and what feeds it. */
const GATEWAY_DIRS = [
  'packages/llm/',
  'packages/ai-gateway/',
  'packages/shared/src/vendors/',
  'apps/vendor-sandbox/',
];

/** Files allowed by name. Each must still call a model host, or its entry is stale. */
const ALLOWED_FILES: Record<string, string> = {
  'apps/web/app/home/[account]/settings/_lib/server/api-keys-actions.ts':
    'BYOK key validation: lists the models a key can see, generates nothing',
  'apps/web/lambda/llm-worker/utils/voyage-embedder.ts':
    'the worker embedder; moves behind the gateway in FILM-1902 part B',
};

/** The vendors in the resolver that are models: text, embeddings or both. */
const MODEL_VENDORS = [
  'gemini',
  'gemini-vertex',
  'openai',
  'anthropic',
  'deepseek',
  'voyage',
] as const satisfies readonly Vendor[];

const MODEL_HOSTS = MODEL_VENDORS.map(
  (vendor) => new URL(VENDORS[vendor]).host,
);

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const VENDOR_NAMES = MODEL_VENDORS.map(escapeRegExp).join('|');

interface Rule {
  name: string;
  pattern: RegExp;
}

const RULES: Rule[] = [
  {
    name: 'names a model host',
    pattern: new RegExp(
      `(?<![\\w.-])(?:${MODEL_HOSTS.map(escapeRegExp).join('|')})(?![\\w-])`,
    ),
  },
  {
    name: 'asks the resolver for a model vendor',
    pattern: new RegExp(
      `\\bvendorUrl\\(\\s*['"\`](?:${VENDOR_NAMES})['"\`]|\\bVENDORS\\s*(?:\\.|\\[\\s*['"\`])(?:${VENDOR_NAMES})\\b`,
    ),
  },
];

const ANY_RULE = new RegExp(
  RULES.map((rule) => `(?:${rule.pattern.source})`).join('|'),
);

function sourceFiles(path: string): string[] {
  const absolute = join(REPO, path);

  if (!statSync(absolute).isDirectory()) return SOURCE.test(path) ? [path] : [];

  return readdirSync(absolute).flatMap((entry) =>
    SKIP_DIRS.has(entry) ? [] : sourceFiles(join(path, entry)),
  );
}

const FILES = ROOTS.flatMap(sourceFiles)
  .map((file) => relative(REPO, join(REPO, file)).split(sep).join('/'))
  .filter((file) => !TEST_FILE.test(file));

export function isAllowed(file: string) {
  return (
    GATEWAY_DIRS.some((dir) => file.startsWith(dir)) || file in ALLOWED_FILES
  );
}

/** Every model-host reference in `source`, as if it were the file at `file`. */
export function modelHostCalls(file: string, source: string) {
  return source.split('\n').flatMap((line, index) => {
    if (!ANY_RULE.test(line)) return [];

    return RULES.filter((rule) => rule.pattern.test(line)).map(
      (rule) =>
        `${file}:${index + 1} ${rule.name} - a model is reached through the gateway, not from here (FILM-1902)`,
    );
  });
}

/** The calls the scan reports: those outside the allowlist. */
export function violationsIn(file: string, source: string) {
  return isAllowed(file) ? [] : modelHostCalls(file, source);
}

function read(file: string) {
  return readFileSync(join(REPO, file), 'utf8');
}

describe('a model host is reached only through the gateway (FILM-1902)', () => {
  it('scans the source it claims to', () => {
    expect(FILES.length).toBeGreaterThan(1000);
    expect(FILES).toContain('packages/llm/src/providers/openai.ts');
    expect(FILES).toContain(
      'apps/web/lambda/llm-worker/utils/voyage-embedder.ts',
    );
    expect(FILES).toContain(
      'packages/features/episodes/src/agent/story-orchestrator.ts',
    );
    expect(FILES).not.toContain(
      'packages/llm/__tests__/model-host-guard.test.ts',
    );
  });

  it('finds every call there is, so an empty result means clean and not unread', () => {
    const found = FILES.flatMap((file) =>
      modelHostCalls(file, read(file)).map((call) => call.split(':')[0]),
    );

    expect(found).toEqual(
      expect.arrayContaining([
        'packages/llm/src/providers/openai.ts',
        'packages/llm/src/providers/anthropic.ts',
        'packages/llm/src/providers/gemini.ts',
        'packages/llm/src/providers/deepseek.ts',
        'packages/shared/src/vendors/resolver.ts',
        ...Object.keys(ALLOWED_FILES),
      ]),
    );
  });

  it('names no file in the allowlist that no longer needs it', () => {
    const stale = Object.keys(ALLOWED_FILES).filter(
      (file) => modelHostCalls(file, read(file)).length === 0,
    );

    expect(stale, 'delete these entries from ALLOWED_FILES').toEqual([]);
  });

  it(
    'reaches no model host outside the gateway allowlist',
    { timeout: 60_000 },
    () => {
      const violations = FILES.flatMap((file) =>
        violationsIn(file, read(file)),
      );

      expect(violations).toEqual([]);
    },
  );

  /** Each spelling of a call, fed to the scan as a line of ordinary source. */
  it.each([
    [
      "const url = `${vendorUrl('openai')}/v1/embeddings`;",
      'asks the resolver',
    ],
    ['vendorUrl("gemini-vertex")', 'asks the resolver'],
    ["vendorUrl( 'voyage' )", 'asks the resolver'],
    ["const host = VENDORS['anthropic'];", 'asks the resolver'],
    ['const host = VENDORS.deepseek;', 'asks the resolver'],
    [
      "fetch('https://generativelanguage.googleapis.com/v1beta/models')",
      'names a model host',
    ],
    ['const base = "https://api.openai.com/v1";', 'names a model host'],
    ["baseURL: 'api.anthropic.com'", 'names a model host'],
    ['//aiplatform.googleapis.com/', 'names a model host'],
    ['new URL("https://api.voyageai.com/v1/embeddings")', 'names a model host'],
  ])('fails on %s in a feature package', (line, rule) => {
    const found = violationsIn('packages/features/episodes/src/call.ts', line);

    expect(found).toHaveLength(1);
    expect(found[0]).toContain('packages/features/episodes/src/call.ts:1');
    expect(found[0]).toContain(rule);
  });

  it.each([
    "vendorUrl('elevenlabs')",
    "vendorUrl('meta-graph')",
    'const apiKey = process.env.OPENAI_API_KEY;',
    "const provider = 'openai';",
    'generativelanguage: true,',
  ])('passes %s, which reaches no model', (line) => {
    expect(
      violationsIn('packages/features/episodes/src/call.ts', line),
    ).toEqual([]);
  });

  it('passes the same line inside the gateway, the vendors directory and the sandbox', () => {
    const line = "const url = `${vendorUrl('openai')}/v1/chat/completions`;";

    for (const file of [
      'packages/llm/src/providers/openai.ts',
      'packages/ai-gateway/src/server-writer.ts',
      'packages/shared/src/vendors/resolver.ts',
      'apps/vendor-sandbox/src/llm/server.ts',
    ]) {
      expect(violationsIn(file, line), file).toEqual([]);
    }
  });

  it('reports the line in a file allowed by name only through the stale check', () => {
    const line = "const url = `${vendorUrl('voyage')}/v1/embeddings`;";

    expect(
      violationsIn('apps/web/lambda/llm-worker/utils/voyage-embedder.ts', line),
    ).toEqual([]);
    expect(
      violationsIn('apps/web/lambda/llm-worker/utils/other-embedder.ts', line),
    ).toHaveLength(1);
  });
});
