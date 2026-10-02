import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXPERIMENT_MEASURES,
  EXPERIMENT_MEASURE_DEFINITIONS,
} from '../src/lib/channel-experiments';
import {
  CONTENT_TYPES,
  DURATION_REFINEMENTS,
  FORMAT_BY_CONTENT_TYPE,
  FORMAT_FAMILIES,
  PUBLISH_PLATFORMS,
} from '../src/lib/format-families';

/**
 * FILM-1724 holds "a Short never joins long-form" in Postgres, so
 * `public.publish_format_family` restates FILM-1716's two tables in SQL.
 * Two copies of one rule drift unless something reads both: this does.
 */
const MIGRATIONS = join(__dirname, '../../../apps/web/supabase/migrations');

function latestDefinition(name: string): string {
  const files = readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith('.sql'))
    .sort()
    .reverse();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    const start = sql.indexOf(`create or replace function public.${name}(`);
    if (start === -1) continue;

    return sql.slice(start, sql.indexOf('$$;', start));
  }

  throw new Error(`${name} is not defined by any migration`);
}

/**
 * Values the database still holds for rows of a platform the product removed
 * (LinkedIn, FILM-717, owner 2026-10-02). No migration drops them: that would
 * mean deleting rows, which nobody asked for.
 */
const KEPT_FOR_OLD_ROWS = ['linkedin'];

describe('public.publish_format_family', () => {
  const sql = latestDefinition('publish_format_family');
  const declared = sql.slice(
    sql.indexOf('declared ('),
    sql.indexOf('refinement ('),
  );
  const refinement = sql.slice(sql.indexOf('refinement ('));

  it('maps every (platform, content type) pair as FORMAT_BY_CONTENT_TYPE does', () => {
    const pairs = [...declared.matchAll(/\('(\w+)', '(\w+)', '(\w+)'\)/g)]
      .map(([, platform, contentType, family]) => ({
        platform,
        contentType,
        family,
      }))
      .filter(({ platform }) => !KEPT_FOR_OLD_ROWS.includes(platform!));

    const expected = CONTENT_TYPES.flatMap((contentType) =>
      PUBLISH_PLATFORMS.map((platform) => ({
        platform,
        contentType,
        family: FORMAT_BY_CONTENT_TYPE[contentType][platform],
      })),
    );

    expect(pairs).toHaveLength(expected.length);
    expect(pairs).toEqual(expect.arrayContaining(expected));
  });

  it('refines by duration exactly where DURATION_REFINEMENTS does', () => {
    const rules = [
      ...refinement.matchAll(/\('(\w+)', '(\w+)', (\d+), '(\w+)'\)/g),
    ].map(([, platform, contentType, above, family]) => ({
      platform,
      contentType,
      aboveSeconds: Number(above),
      family,
    }));

    expect(rules).toEqual(DURATION_REFINEMENTS.map((rule) => ({ ...rule })));
  });
});

describe('channel_experiments CHECKs', () => {
  const sql = readFileSync(
    join(MIGRATIONS, '20261001114902_channel-experiments.sql'),
    'utf8',
  );

  it('admits exactly the format families FILM-1716 defines', () => {
    const check = sql.slice(
      sql.indexOf('channel_experiments_format_family_check'),
      sql.indexOf('channel_experiments_measures_check'),
    );

    expect([...check.matchAll(/'(\w+)'/g)].map(([, f]) => f).sort()).toEqual(
      [...FORMAT_FAMILIES].sort(),
    );
  });

  it('admits exactly the measures this module computes', () => {
    const check = sql.slice(
      sql.indexOf('channel_experiments_measures_check'),
      sql.indexOf('channel_experiments_hook_short_only_check'),
    );

    expect([...check.matchAll(/'(\w+)'/g)].map(([, m]) => m).sort()).toEqual(
      [...EXPERIMENT_MEASURES].sort(),
    );
  });

  it('offers the hook measure on the families its definition names', () => {
    expect(EXPERIMENT_MEASURE_DEFINITIONS.hook_retention_3s.families).toEqual([
      'short_vertical',
    ]);
    expect(sql).toContain("or format_family = 'short_vertical'");
  });

  it('lets a video leave only before its first checkpoint', () => {
    const first = Math.min(
      ...Object.values(EXPERIMENT_MEASURE_DEFINITIONS).flatMap(
        (definition) => definition.checkpoints,
      ),
    );

    expect(sql).toContain(`published_at <= now() - interval '${first} days'`);
  });
});
