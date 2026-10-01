import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  CLOSED_TAG_VALUES,
  GENOME_DIMENSION_STAGE,
  TAG_DIMENSIONS,
  TAXONOMY_DIMENSIONS,
  durationAttribute,
  durationBandOf,
  parseVideoTag,
  splitVideoTags,
} from '../src/lib/genome-attributes';
import {
  metricProvenanceFor,
  stageMeasureFor,
} from '../src/lib/genome-measures';
import { FUNNEL_STAGES } from '../src/lib/signal-map';

const REPO = resolve(import.meta.dirname, '../../..');
const MIGRATIONS = join(REPO, 'apps/web/supabase/migrations');

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(MIGRATIONS, name), 'utf8'),
    }));
}

/** The last migration to (re)define a content_tags constraint wins. */
function latestConstraint(name: string): string {
  const pattern = new RegExp(
    `add constraint ${name} check \\(([\\s\\S]*?)\\);\\n`,
    'i',
  );
  const hit = migrations()
    .reverse()
    .map(({ sql }) => pattern.exec(sql))
    .find((match) => match !== null);

  if (!hit) throw new Error(`no migration adds ${name}`);

  return hit[1]!.replace(/--[^\n]*/g, '');
}

function quoted(text: string): string[] {
  return [...text.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe('taxonomy, genome and performance are distinct types', () => {
  it('parses a topic as taxonomy and a hook type as a genome attribute', () => {
    expect(parseVideoTag('topic:ai')).toEqual({
      kind: 'taxonomy',
      dimension: 'topic',
      value: 'ai',
      tag: 'topic:ai',
    });
    expect(parseVideoTag('hook_type:cold-open')).toEqual({
      kind: 'genome',
      layer: 'observable',
      dimension: 'hook_type',
      value: 'cold-open',
      tag: 'hook_type:cold-open',
      source: 'tag',
    });
  });

  it('never parses a tag as performance: no dimension is a funnel stage', () => {
    for (const stage of FUNNEL_STAGES) {
      expect(TAG_DIMENSIONS as readonly string[]).not.toContain(stage);
      expect(parseVideoTag(`${stage}:high`)).toBeNull();
    }
  });

  it('drops a closed dimension’s value outside its list, and unknown dimensions', () => {
    expect(parseVideoTag('face_present:maybe')).toBeNull();
    expect(parseVideoTag('face_present:yes')?.kind).toBe('genome');
    expect(parseVideoTag('mood:sad')).toBeNull();
    expect(parseVideoTag('no-separator')).toBeNull();
    expect(parseVideoTag('topic:')).toBeNull();
  });

  it('keeps taxonomy out of the genome when a video’s tags are split', () => {
    const { taxonomy, genome } = splitVideoTags([
      'topic:ai',
      'format:tutorial',
      'result_first:yes',
      'stray',
    ]);

    expect(taxonomy.map((tag) => tag.tag)).toEqual([
      'topic:ai',
      'format:tutorial',
    ]);
    expect(genome.map((tag) => tag.tag)).toEqual(['result_first:yes']);
  });

  it('derives duration from the asset length, never a tag', () => {
    expect(durationBandOf(null)).toBeNull();
    expect(durationBandOf(0)).toBeNull();
    expect(durationBandOf(14.9)).toBe('under-15s');
    expect(durationBandOf(15)).toBe('15-to-60s');
    expect(durationBandOf(59)).toBe('15-to-60s');
    expect(durationBandOf(60)).toBe('1-to-3m');
    expect(durationBandOf(1200)).toBe('over-20m');
    expect(durationAttribute(300)).toMatchObject({
      dimension: 'duration',
      value: '3-to-10m',
      source: 'video_dim',
    });
    expect(parseVideoTag('duration:3-to-10m')).toBeNull();
  });

  it('gives every genome dimension a stage, and no taxonomy dimension one', () => {
    for (const dimension of TAG_DIMENSIONS) {
      const taxonomy = (TAXONOMY_DIMENSIONS as readonly string[]).includes(
        dimension,
      );
      expect(Object.hasOwn(GENOME_DIMENSION_STAGE, dimension)).toBe(!taxonomy);
    }
  });
});

describe('attributes flow through the existing tag store, with no ClickHouse migration', () => {
  it('the content_tags CHECK names exactly TAG_DIMENSIONS', () => {
    expect(
      quoted(latestConstraint('content_tags_dimension_check')).sort(),
    ).toEqual([...TAG_DIMENSIONS].sort());
  });

  it('the closed-values CHECK holds exactly CLOSED_TAG_VALUES', () => {
    const body = latestConstraint('content_tags_genome_closed_values_check');
    const fromSql: Record<string, string[]> = {};

    for (const match of body.matchAll(
      /when '([a-z0-9_]+)' then slug in \(([^)]*)\)/g,
    )) {
      fromSql[match[1]!] = quoted(match[2]!);
    }

    expect(fromSql).toEqual(CLOSED_TAG_VALUES);
  });

  it('touches no ClickHouse migration', () => {
    const clickhouse = readdirSync(
      join(REPO, 'packages/clickhouse/src/migrations'),
    ).filter((name) => /^\d{3}_/.test(name));

    // 018 was the last before FILM-1717; the genome must not add one.
    expect(clickhouse.sort().at(-1)).toBe('018_reposts.ts');
  });
});

describe("the Hook Lab's hook_type vocabulary is reconciled with the taxonomy's", () => {
  it('the free-text hook_variants.hook_type is gone with its table', () => {
    const all = migrations();
    const created = all.findIndex(({ sql }) =>
      /create table[^;]*hook_variants[\s\S]*?hook_type\s+text/i.test(sql),
    );
    const dropped = all.findIndex(({ sql }) =>
      /drop table public\.hook_variants;/i.test(sql),
    );

    expect(created).toBeGreaterThanOrEqual(0);
    expect(dropped).toBeGreaterThan(created);
  });

  it('no table left declares a hook_type column of its own: content_tags is the vocabulary', () => {
    const all = migrations();
    const dropped = all.findIndex(({ sql }) =>
      /drop table public\.hook_variants;/i.test(sql),
    );
    const later = all
      .slice(dropped + 1)
      .filter(({ sql }) =>
        /^\s*hook_type\s+(text|varchar|character)/im.test(sql),
      )
      .map(({ name }) => name);

    expect(later).toEqual([]);
    expect(TAG_DIMENSIONS).toContain('hook_type');
  });
});

describe('the stage-aware measure', () => {
  it('scores an attribute on its stage’s primary signal', () => {
    expect(
      stageMeasureFor({
        platform: 'youtube',
        formatFamily: 'long_horizontal',
        stage: 'transmission',
      }),
    ).toEqual({ ok: true, stage: 'transmission', signal: 'share_rate' });
    expect(
      stageMeasureFor({
        platform: 'youtube',
        formatFamily: 'long_horizontal',
        stage: 'hook',
      }),
    ).toEqual({ ok: true, stage: 'hook', signal: 'impressions_ctr' });
  });

  it('refuses a stage the platform cannot fill, by name, rather than scoring views', () => {
    const tiktokHook = stageMeasureFor({
      platform: 'tiktok',
      formatFamily: 'short_vertical',
      stage: 'hook',
    });
    expect(tiktokHook.ok).toBe(false);
    if (!tiktokHook.ok) expect(tiktokHook.refusal.kind).toBe('stage_unbound');

    const shortHook = stageMeasureFor({
      platform: 'youtube',
      formatFamily: 'short_vertical',
      stage: 'hook',
    });
    expect(shortHook).toEqual({
      ok: false,
      stage: 'hook',
      refusal: { kind: 'no_checkpoint_measure', signal: 'first_3s_retention' },
    });
  });

  it('names the provider fields and ingestion path behind a measure', () => {
    const provenance = metricProvenanceFor('impressions_ctr', 'youtube');

    expect(provenance.inputs.map((input) => input.family)).toEqual(['reach']);
    expect(provenance.inputs[0].table).toBe('video_reach_daily');
    expect(provenance.inputs[0].providerFields.length).toBeGreaterThan(0);
    expect(provenance.ingestionPath).toContain('video_reach_daily');
  });
});
