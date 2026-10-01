import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DURATION_UNKNOWN } from '../src/lib/asset-duration';
import {
  CONTENT_TYPES,
  DURATION_REFINEMENTS,
  FORMAT_BY_CONTENT_TYPE,
  FORMAT_FAMILIES,
  PUBLISH_PLATFORMS,
  contentTypesFor,
  formatFamilyOfDim,
  formatFamilyPredicate,
  resolveFormatFamily,
  unmappedFormatPairs,
} from '../src/lib/format-families';

const REPO = join(import.meta.dirname, '../../..');
const MIGRATIONS = join(REPO, 'apps/web/supabase/migrations');

function inList(sql: string): string[] {
  return [...sql.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

/** The `create table public.publishes` statement, as written. */
function publishesTable(): string {
  for (const file of readdirSync(MIGRATIONS).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const start = sql.search(
      /create table if not exists public\.publishes\s*\(/i,
    );
    if (start >= 0) return sql.slice(start, sql.indexOf(');', start));
  }

  throw new Error('no migration creates public.publishes');
}

describe('the vocabularies match the database (FILM-1716)', () => {
  const table = publishesTable();

  it('CONTENT_TYPES is publishes.content_type’s CHECK, so a new value fails here', () => {
    const check = /check \(content_type in \(([^)]*)\)\)/i.exec(table);

    expect(check).not.toBeNull();
    expect([...CONTENT_TYPES].sort()).toEqual(inList(check![1]!).sort());
  });

  it('PUBLISH_PLATFORMS is publishes.platform’s CHECK', () => {
    const check = /check \(platform in \(([^)]*)\)\)/i.exec(table);

    expect(check).not.toBeNull();
    expect([...PUBLISH_PLATFORMS].sort()).toEqual(inList(check![1]!).sort());
  });

  it('no later migration rewrites either CHECK behind this test’s back', () => {
    // If one does, teach `publishesTable` to read it — do not delete this.
    const rewrites = readdirSync(MIGRATIONS).filter((file) =>
      /alter table[^;]*publishes[^;]*(content_type|platform)[^;]*check/i.test(
        readFileSync(join(MIGRATIONS, file), 'utf8'),
      ),
    );

    expect(rewrites).toEqual([]);
  });
});

describe('FORMAT_BY_CONTENT_TYPE', () => {
  it('maps every content type on every platform to a family', () => {
    for (const contentType of CONTENT_TYPES) {
      for (const platform of PUBLISH_PLATFORMS) {
        expect(FORMAT_FAMILIES).toContain(
          FORMAT_BY_CONTENT_TYPE[contentType][platform],
        );
      }
    }
  });

  it('gives teaser and trailer their own families, on every platform', () => {
    for (const platform of PUBLISH_PLATFORMS) {
      expect(FORMAT_BY_CONTENT_TYPE.teaser[platform]).toBe('teaser');
      expect(FORMAT_BY_CONTENT_TYPE.trailer[platform]).toBe('trailer');
    }
  });

  it('maps the same clip to different families on two platforms', () => {
    const youtube = resolveFormatFamily({
      platform: 'youtube',
      contentType: 'short',
      assetDuration: { known: true, seconds: 45 },
    });
    const x = resolveFormatFamily({
      platform: 'twitter',
      contentType: 'short',
      assetDuration: { known: true, seconds: 45 },
    });

    expect(youtube).toMatchObject({ ok: true, family: 'short_vertical' });
    expect(x).toMatchObject({ ok: true, family: 'clip' });
  });

  it('maps nothing to live until live publishing exists', () => {
    for (const platform of PUBLISH_PLATFORMS) {
      expect(contentTypesFor('live', platform)).toEqual([]);
    }
  });

  it('separates orientation where content_type cannot', () => {
    expect(FORMAT_BY_CONTENT_TYPE.full.youtube).toBe('long_horizontal');
    expect(FORMAT_BY_CONTENT_TYPE.full.tiktok).toBe('long_vertical');
  });
});

describe('resolveFormatFamily', () => {
  it('refuses a content type it does not know rather than defaulting', () => {
    expect(
      resolveFormatFamily({
        platform: 'youtube',
        contentType: 'podcast',
        assetDuration: DURATION_UNKNOWN,
      }),
    ).toEqual({
      ok: false,
      reason: 'unmapped_content_type',
      platform: 'youtube',
      contentType: 'podcast',
    });
  });

  it('refuses a platform it does not know', () => {
    expect(
      resolveFormatFamily({
        platform: 'snapchat',
        contentType: 'short',
        assetDuration: DURATION_UNKNOWN,
      }),
    ).toMatchObject({ ok: false, reason: 'unmapped_platform' });
  });

  it('falls back to the declared family when the duration is unknown', () => {
    expect(
      resolveFormatFamily({
        platform: 'youtube',
        contentType: 'short',
        assetDuration: DURATION_UNKNOWN,
      }),
    ).toEqual({
      ok: true,
      family: 'short_vertical',
      declared: 'short_vertical',
      basis: 'declared',
      duration: DURATION_UNKNOWN,
    });
  });

  it('moves a YouTube short past three minutes to long_vertical, and says why', () => {
    expect(
      resolveFormatFamily({
        platform: 'youtube',
        contentType: 'short',
        assetDuration: { known: true, seconds: 181 },
      }),
    ).toMatchObject({
      ok: true,
      family: 'long_vertical',
      declared: 'short_vertical',
      basis: 'asset_duration',
    });
  });

  it('keeps a YouTube short at exactly three minutes a Short', () => {
    expect(
      resolveFormatFamily({
        platform: 'youtube',
        contentType: 'short',
        assetDuration: { known: true, seconds: 180 },
      }),
    ).toMatchObject({ family: 'short_vertical', basis: 'declared' });
  });

  it('does not apply YouTube’s rule to another platform', () => {
    expect(
      resolveFormatFamily({
        platform: 'tiktok',
        contentType: 'short',
        assetDuration: { known: true, seconds: 600 },
      }),
    ).toMatchObject({ family: 'short_vertical', basis: 'declared' });
  });

  it('never reads an episode duration: a dim row’s null asset duration is unknown', () => {
    expect(
      formatFamilyOfDim({
        platform: 'youtube',
        content_type: 'short',
        asset_duration_seconds: null,
      }),
    ).toMatchObject({
      family: 'short_vertical',
      basis: 'declared',
      duration: DURATION_UNKNOWN,
    });
    expect(
      formatFamilyOfDim({
        platform: 'youtube',
        content_type: 'short',
        asset_duration_seconds: 0,
      }),
    ).toMatchObject({ basis: 'declared', duration: DURATION_UNKNOWN });
  });
});

describe('unmappedFormatPairs', () => {
  it('names each unmapped pair once and passes the mapped ones', () => {
    expect(
      unmappedFormatPairs([
        { platform: 'youtube', content_type: 'full' },
        { platform: 'youtube', content_type: 'podcast' },
        { platform: 'youtube', content_type: 'podcast' },
        { platform: 'snapchat', content_type: 'short' },
      ]),
    ).toEqual([
      { platform: 'youtube', content_type: 'podcast' },
      { platform: 'snapchat', content_type: 'short' },
    ]);
  });
});

describe('formatFamilyPredicate', () => {
  it('selects the declared pairs, less the ones a refinement claims', () => {
    const { sql, params } = formatFamilyPredicate('short_vertical');

    expect(sql).toContain(
      "concat(platform, ':', content_type) IN {fmtDeclared: Array(String)}",
    );
    expect(sql).toContain('NOT (platform = {fmtR0Platform: String}');
    expect(sql).toContain('ifNull(asset_duration_seconds, 0) >');
    expect(params.fmtDeclared).toEqual(
      expect.arrayContaining(['youtube:short', 'tiktok:short']),
    );
    expect(params.fmtDeclared).not.toContain('twitter:short');
    expect(params.fmtR0Above).toBe(DURATION_REFINEMENTS[0]!.aboveSeconds);
  });

  it('adds the refined rows to the family they move into', () => {
    const { sql } = formatFamilyPredicate('long_vertical');

    expect(sql).toContain('IN {fmtDeclared');
    expect(sql).toMatch(/OR \(\(platform = \{fmtR0Platform: String\}/);
    expect(sql).not.toContain('NOT (');
  });

  it('selects nothing for a family nothing maps to', () => {
    expect(formatFamilyPredicate('live')).toEqual({ sql: '0', params: {} });
  });

  it('binds only the parameters it references', () => {
    const { sql, params } = formatFamilyPredicate('teaser', 'p');

    for (const name of Object.keys(params)) {
      expect(sql).toContain(`{${name}:`);
    }
  });
});

/**
 * No analytics code keys a lookup on 'short' | 'long' (FILM-1716).
 *
 * That split dropped `teaser` and `trailer` silently and pooled every
 * platform's shorts together. The families above are the axis; a comparison
 * at a call site is the thing this exists to stop coming back.
 */
describe('no consumer keys a lookup on short | long', () => {
  const ROOTS = [
    'packages/clickhouse/src',
    'packages/features/content-analytics/src',
  ];
  const ALLOWED = new Set(['packages/clickhouse/src/lib/format-families.ts']);
  const FORBIDDEN = [
    /content_?type\s*[!=]==?\s*['"](full|short|teaser|trailer|long)['"]/i,
    /['"]short['"]\s*\|\s*['"]long['"]/,
    /['"]long['"]\s*\|\s*['"]short['"]/,
    /\blongForm\b/,
  ];

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        return name === '__tests__' ? [] : sources(path);
      }
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  const files = ROOTS.flatMap((root) => sources(join(REPO, root)));

  it('reads the sources it checks', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('finds none outside the family table', () => {
    const offenders = files.flatMap((file) => {
      const path = relative(REPO, file);
      if (ALLOWED.has(path)) return [];

      return readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          FORBIDDEN.some((pattern) => pattern.test(line))
            ? [`${path}:${index + 1}: ${line.trim()}`]
            : [],
        );
    });

    expect(offenders).toEqual([]);
  });
});
