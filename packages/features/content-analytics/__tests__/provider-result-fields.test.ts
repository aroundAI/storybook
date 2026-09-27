import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * FILM-1712, the other half of FILM-1721's rule. `platform-field-names.test.ts`
 * stops a request asking for a field the reference does not document. This
 * stops a result claiming a field the request never asked for.
 *
 * Both halves exist because of the same mistake. Instagram's totals declared
 * `profileVisits` and `follows`, which Meta does not provide for Reels and
 * which we never requested; `follows` then became every Instagram row's
 * `subscribers_gained`, a 0 that looked measured. TikTok's totals declared
 * five figures the Display API does not return, each a literal 0.
 *
 * The rule, for each cumulative provider's per-video `totals`: every field
 * is read from a vendor field the same provider requests. A literal — the
 * "structurally zero" of the old code — is not a field; the absence belongs
 * in the capability matrix and the writer, not in a number here.
 */

const PROVIDERS = join(__dirname, '..', 'src', 'providers');

function read(path: string) {
  return readFileSync(join(PROVIDERS, path), 'utf8');
}

/** The `totals: { … }` object in a result, by brace matching. */
function totalsBlock(source: string): string {
  const start = source.indexOf('totals: {');

  if (start < 0) throw new Error('no totals block');

  let depth = 0;

  for (let index = source.indexOf('{', start); index < source.length; index++) {
    if (source[index] === '{') depth++;
    if (source[index] === '}') depth--;
    if (depth === 0) return source.slice(start, index + 1);
  }

  throw new Error('unterminated totals block');
}

/** `key: <source>.<vendor_field> …` entries, and anything that is not one. */
function totalsEntries(block: string, sourceName: string) {
  const body = block
    .slice(block.indexOf('{') + 1, -1)
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');

  return body
    .split(/,\s*\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [key, value = ''] = entry.split(/:\s*/, 2);
      const field = new RegExp(`^${sourceName}\\.(\\w+)\\b`).exec(value.trim());

      return {
        key: key!.trim(),
        value: value.trim(),
        vendor: field?.[1] ?? null,
      };
    });
}

const CASES = [
  {
    platform: 'instagram',
    file: 'instagram/instagram-insights.ts',
    sourceName: 'metrics',
    requested(source: string) {
      const declaration = /const metricsForType\s*=([\s\S]*?);/.exec(
        source,
      )?.[1];

      if (!declaration) throw new Error('no metricsForType');

      return [...declaration.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    },
  },
  {
    platform: 'tiktok',
    file: 'tiktok/tiktok-analytics.ts',
    sourceName: 'video',
    requested(source: string) {
      const fields = /\/video\/query\/\?fields=([a-z_,]+)/.exec(source)?.[1];

      if (!fields) throw new Error('no /video/query/ field list');

      return fields.split(',');
    },
  },
];

describe('a provider result claims only what its request asked for', () => {
  it.each(CASES)(
    '$platform: every total is read from a requested field',
    (entry) => {
      const source = read(entry.file);
      const requested = new Set(entry.requested(source));
      const entries = totalsEntries(totalsBlock(source), entry.sourceName);

      expect(entries.length).toBeGreaterThan(0);

      const offenders = entries
        .filter(({ vendor }) => vendor === null || !requested.has(vendor))
        .map(({ key, value }) => `${key}: ${value}`);

      expect(
        offenders,
        `not read from a requested field (requested: ${[...requested].join(', ')})`,
      ).toEqual([]);
    },
  );
});
