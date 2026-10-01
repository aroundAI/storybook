import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB-146's class. shadcn's older themes stored a token as a bare HSL triple
 * (`--card: 0 0% 7%`) for callers to wrap as `hsl(var(--card))`. Ours are
 * full colours — `oklch(…)`, `#121212`, `var(--color-white)` — so the
 * wrapper reads `hsl(#121212)`, which is invalid CSS: the browser drops the
 * declaration and the property falls back to transparent. Two analytics
 * tooltips drew with no background, and a sidebar ring never drew.
 *
 * Wrapping a token in `hsl()` is allowed only when every stylesheet that
 * declares it declares a triple.
 */

const REPO = resolve(__dirname, '../../..');
const SELF = 'packages/shared/__tests__/colour-tokens-not-hsl.test.ts';

const TRIPLE = /^[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/;
const WRAPPED = /hsla?\(\s*var\(\s*--([\w-]+)/g;

function tracked(...patterns: string[]) {
  return execFileSync('git', ['ls-files', '--', ...patterns], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
}

/** Every declared value of every token, across all stylesheets given. */
export function declarations(stylesheets: string[]) {
  const values = new Map<string, string[]>();

  for (const css of stylesheets) {
    for (const [, name, value] of css.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
      values.set(name!, [...(values.get(name!) ?? []), value!.trim()]);
    }
  }

  return values;
}

/** `hsl(var(--x))` uses whose token is not declared as an HSL triple. */
export function invalidWraps(
  source: string,
  tokens: Map<string, string[]>,
): string[] {
  return [...source.matchAll(WRAPPED)]
    .map((match) => match[1]!)
    .filter((name) => {
      const values = tokens.get(name);
      return !values?.length || !values.every((v) => TRIPLE.test(v));
    });
}

describe('colour tokens are not wrapped in hsl() (KB-146)', () => {
  const tokens = declarations(
    tracked('apps/*.css', 'packages/*.css').map((file) =>
      readFileSync(join(REPO, file), 'utf8'),
    ),
  );
  const sources = tracked(
    'apps/*.ts',
    'apps/*.tsx',
    'apps/*.css',
    'apps/*.mdx',
    'packages/*.ts',
    'packages/*.tsx',
    'packages/*.css',
    'packages/*.mdx',
  ).filter((file) => file !== SELF);

  it('reads the stylesheets and sources it is checking', () => {
    expect(tokens.get('card')?.length).toBeGreaterThan(1);
    expect(sources.length).toBeGreaterThan(500);
  });

  it('leaves no hsl(var(--…)) on a token that is a full colour', () => {
    const found = sources.flatMap((file) =>
      invalidWraps(readFileSync(join(REPO, file), 'utf8'), tokens).map(
        (token) => `${file}: hsl(var(--${token}))`,
      ),
    );

    expect(found, 'use var(--token) or the Tailwind utility').toEqual([]);
  });

  it('tells a triple from a full colour', () => {
    const sample = declarations([
      ':root { --triple: 0 0% 7%; --hex: #121212; --ok: oklch(53% 0.15 250); }',
      '.dark { --mixed: 0 0% 7%; } :root { --mixed: var(--color-white); }',
    ]);

    expect(invalidWraps("color: 'hsl(var(--triple))'", sample)).toEqual([]);
    expect(invalidWraps('hsl(var(--triple) / 0.5)', sample)).toEqual([]);
    expect(invalidWraps("'hsl(var(--hex))'", sample)).toEqual(['hex']);
    expect(invalidWraps('hsla(var(--ok), 0.5)', sample)).toEqual(['ok']);
    expect(
      invalidWraps('shadow-[0_0_0_1px_hsl(var(--mixed))]', sample),
    ).toEqual(['mixed']);
    expect(invalidWraps('hsl(var(--undeclared))', sample)).toEqual([
      'undeclared',
    ]);
    expect(invalidWraps("backgroundColor: 'var(--hex)'", sample)).toEqual([]);
  });
});
