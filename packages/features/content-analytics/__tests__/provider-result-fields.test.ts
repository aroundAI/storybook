import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  INSTAGRAM_AGGREGATES,
  INSTAGRAM_AGGREGATE_FIELDS,
} from '@kit/clickhouse';

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

/**
 * `key: <source>.<vendor_field> …` entries, and anything that is not one.
 * `sources` names each object a total may be read from, with what that
 * object's request asked for.
 */
function totalsEntries(block: string, sources: Record<string, Set<string>>) {
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
      const field = /^(\w+)\.(\w+)\b/.exec(value.trim());
      const requested = field ? sources[field[1]!] : undefined;

      return {
        key: key!.trim(),
        value: value.trim(),
        requested: Boolean(requested?.has(field![2]!)),
      };
    });
}

const CASES = [
  {
    platform: 'instagram',
    file: 'instagram/instagram-insights.ts',
    sources(source: string) {
      const declaration = /const metricsForType\s*=([\s\S]*?);/.exec(
        source,
      )?.[1];

      if (!declaration) throw new Error('no metricsForType');

      // The media-info call's Media node fields (FILM-1712: reposts_count).
      const nodeFields = /\/\$\{mediaId\}\?fields=([a-z_,]+)/.exec(source)?.[1];

      if (!nodeFields) throw new Error('no media-info field list');

      // FILM-1722: the aggregates are requested from the registry's list,
      // never spelled out, so only a defined aggregate can be asked for.
      const aggregates = source.includes(',${INSTAGRAM_AGGREGATE_FIELDS}`')
        ? INSTAGRAM_AGGREGATES.map((aggregate) => aggregate.field)
        : [];

      return {
        metrics: new Set(
          [...declaration.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!),
        ),
        mediaInfo: new Set([
          ...nodeFields.split(',').filter(Boolean),
          ...aggregates,
        ]),
      };
    },
  },
  {
    platform: 'tiktok',
    file: 'tiktok/tiktok-analytics.ts',
    sources(source: string) {
      const fields = /\/video\/query\/\?fields=([a-z_,]+)/.exec(source)?.[1];

      if (!fields) throw new Error('no /video/query/ field list');

      return { video: new Set(fields.split(',')) };
    },
  },
];

describe('a provider result claims only what its request asked for', () => {
  it.each(CASES)(
    '$platform: every total is read from a requested field',
    (entry) => {
      const source = read(entry.file);
      const sources = entry.sources(source);
      const entries = totalsEntries(totalsBlock(source), sources);

      expect(entries.length).toBeGreaterThan(0);

      const offenders = entries
        .filter(({ requested }) => !requested)
        .map(({ key, value }) => `${key}: ${value}`);

      expect(
        offenders,
        `not read from a requested field (requested: ${Object.entries(sources)
          .map(([name, fields]) => `${name}: ${[...fields].join(', ')}`)
          .join('; ')})`,
      ).toEqual([]);
    },
  );
});

// FILM-1722: Instagram's all-surface aggregates are requested only once
// defined in INSTAGRAM_AGGREGATES, and never land in views, likes or comments.
describe('Instagram aggregates (FILM-1722)', () => {
  const source = read('instagram/instagram-insights.ts');
  const block = totalsBlock(source);

  it('requests them from the registry list, never by name', () => {
    const literal =
      /\/\$\{mediaId\}\?fields=([a-z_,]+)/.exec(source)?.[1] ?? '';

    expect(source).toContain(',${INSTAGRAM_AGGREGATE_FIELDS}`');
    expect(literal.split(',').filter((f) => /^total_/.test(f))).toEqual([]);
  });

  it.each(INSTAGRAM_AGGREGATES)(
    'stores $field in its own total, not in views, likes or comments',
    ({ field }) => {
      const reads = [...block.matchAll(/(\w+):\s*mediaInfo\.(\w+)/g)]
        .filter((m) => m[2] === field)
        .map((m) => m[1]);

      expect(reads).toHaveLength(1);
      expect(reads[0]).toMatch(/^allSurface/);
    },
  );
});
