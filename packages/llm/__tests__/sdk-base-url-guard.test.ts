import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1805 §3.4. An LLM SDK constructed without a base URL falls back to
 * its own environment variable (OPENAI_BASE_URL, ANTHROPIC_BASE_URL,
 * GOOGLE_GEMINI_BASE_URL, GOOGLE_VERTEX_BASE_URL), which redirects the
 * request and its key with none of FILM-1801's gate. So every construction
 * passes one, from vendorUrl(), and nothing else reads a *_BASE_URL variable
 * to decide where a vendor lives.
 *
 * `sdk-base-urls.test.ts` proves the four sites behave; this finds the
 * fifth before it is written.
 */

const REPO = resolve(__dirname, '../../..');
const ROOTS = ['packages', 'apps'];
const RESOLVER = 'packages/shared/src/vendors/resolver.ts';
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

const SDK_CONSTRUCTOR = /\bnew\s+(OpenAI|Anthropic|GoogleGenAI)\s*\(/g;
/** `baseURL: x`, or the shorthand `baseURL,` / `{ baseURL }`. */
const BASE_URL_OPTION = /\bbase(?:URL|Url)\s*[:,}\n]/;
const BASE_URL_ENV_READ =
  /process\.env(?:\.([A-Z0-9_]*_BASE_URL)\b|\[\s*['"`]([A-Z0-9_]*_BASE_URL)['"`]\s*\])/g;

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

function lineOf(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

/** The argument list of the call whose `(` is at `open`. */
function argumentsFrom(source: string, open: number) {
  let depth = 0;

  for (let at = open; at < source.length; at++) {
    if (source[at] === '(') depth++;
    if (source[at] === ')' && --depth === 0) return source.slice(open, at + 1);
  }

  return source.slice(open);
}

function constructionsWithoutBaseUrl() {
  return FILES.flatMap((file) => {
    const source = readFileSync(join(REPO, file), 'utf8');

    return [...source.matchAll(SDK_CONSTRUCTOR)]
      .filter((match) => {
        const open = match.index + match[0].length - 1;
        return !BASE_URL_OPTION.test(argumentsFrom(source, open));
      })
      .map(
        (match) =>
          `${file}:${lineOf(source, match.index)} new ${match[1]}() without a base URL - pass one from vendorUrl()`,
      );
  });
}

function baseUrlEnvReads() {
  return FILES.filter((file) => file !== RESOLVER).flatMap((file) => {
    const source = readFileSync(join(REPO, file), 'utf8');

    return [...source.matchAll(BASE_URL_ENV_READ)]
      .map((match) => ({ match, name: match[1] ?? match[2] ?? '' }))
      .map(
        ({ match, name }) =>
          `${file}:${lineOf(source, match.index)} reads ${name} - a vendor host comes from vendorUrl()`,
      );
  });
}

describe('LLM SDKs never choose their own host (FILM-1805)', () => {
  it('scans the source it claims to', () => {
    expect(FILES.length).toBeGreaterThan(1000);
    expect(FILES).toContain('packages/llm/src/providers/openai.ts');
    expect(FILES).toContain('packages/llm/src/providers/gemini.ts');
    expect(FILES).not.toContain('packages/llm/__tests__/sdk-base-urls.test.ts');
  });

  it('finds every construction, so an empty result means clean and not unread', () => {
    const constructed = FILES.flatMap((file) =>
      [...readFileSync(join(REPO, file), 'utf8').matchAll(SDK_CONSTRUCTOR)].map(
        (match) => `${file} ${match[1]}`,
      ),
    );

    expect(constructed).toEqual(
      expect.arrayContaining([
        'packages/llm/src/providers/openai.ts OpenAI',
        'packages/llm/src/providers/anthropic.ts Anthropic',
        'packages/llm/src/providers/gemini.ts GoogleGenAI',
        'packages/llm/src/transcription.ts OpenAI',
      ]),
    );
  });

  it(
    'constructs every OpenAI, Anthropic and GoogleGenAI client with a base URL',
    { timeout: 60_000 },
    () => {
      expect(constructionsWithoutBaseUrl()).toEqual([]);
    },
  );

  it(
    'reads no *_BASE_URL variable outside the resolver',
    { timeout: 60_000 },
    () => {
      expect(baseUrlEnvReads()).toEqual([]);
    },
  );
});
