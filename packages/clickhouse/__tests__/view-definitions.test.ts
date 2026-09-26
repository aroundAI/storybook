import { describe, expect, it } from 'vitest';

import type { PlatformId, ViewDefinition } from '../src/lib/view-definitions';
import {
  PLATFORM_IDS,
  VIEW_DEFINITIONS,
  comparableAcross,
  viewDefinitionAt,
  viewDefinitionChangesBetween,
  viewsDenominatorFor,
} from '../src/lib/view-definitions';

function definition(id: string): ViewDefinition {
  const found = VIEW_DEFINITIONS.find((entry) => entry.id === id);

  if (!found) throw new Error(`No view definition '${id}'`);

  return found;
}

function definitionsFor(platform: PlatformId) {
  return VIEW_DEFINITIONS.filter((entry) => entry.platform === platform);
}

describe('VIEW_DEFINITIONS', () => {
  it('records at least one definition for every platform in the union', () => {
    // PLATFORM_IDS is derived from a Record<PlatformId, true>, so widening
    // the union is a type error until the platform is listed — and listing
    // it lands here, where it fails until a definition exists.
    for (const platform of PLATFORM_IDS) {
      expect(
        definitionsFor(platform).length,
        `${platform} has no view definition`,
      ).toBeGreaterThan(0);
    }
  });

  it('gives every ingested platform a definition behind its views column', () => {
    // The three platforms `video_metrics.views` can hold today. Facebook and
    // X are recorded but inert, so no definition of theirs claims the column.
    for (const platform of ['youtube', 'tiktok', 'instagram'] as const) {
      expect(
        definitionsFor(platform).some((entry) => entry.role === 'views_column'),
        `${platform} has nothing behind video_metrics.views`,
      ).toBe(true);
    }

    for (const platform of ['facebook', 'x'] as const) {
      expect(
        definitionsFor(platform).every((entry) => entry.role === 'concurrent'),
      ).toBe(true);
    }
  });

  it('uses unique ids', () => {
    const ids = VIEW_DEFINITIONS.map((entry) => entry.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('dates every superseding definition, against one on the same platform', () => {
    for (const entry of VIEW_DEFINITIONS) {
      if (entry.supersedes === undefined) continue;

      const replaced = definition(entry.supersedes);

      expect(replaced.platform, entry.id).toBe(entry.platform);
      expect(replaced.role, entry.id).toBe(entry.role);
      expect(entry.effectiveFrom, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('never ends a rollout before it begins', () => {
    for (const entry of VIEW_DEFINITIONS) {
      if (entry.rolloutCompleteBy === undefined) continue;

      expect(entry.effectiveFrom, entry.id).not.toBeNull();
      expect(entry.rolloutCompleteBy >= entry.effectiveFrom!, entry.id).toBe(
        true,
      );
    }
  });

  it('records both YouTube changes, with the dates the vendor gives', () => {
    const unified = definition('youtube.views.2026-08-27');
    const shorts = definition('youtube.views.shorts.2025-03-31');

    expect(unified).toMatchObject({
      field: 'views',
      effectiveFrom: '2026-08-27',
      countsFrom: 'first_frame',
      appliesTo: 'all_formats',
      supersedes: 'youtube.views.legacy',
    });
    expect(shorts).toMatchObject({
      field: 'views',
      effectiveFrom: '2025-03-31',
      countsFrom: 'first_frame',
      appliesTo: 'shorts',
      includesReplays: true,
      supersedes: 'youtube.views.legacy',
    });
  });

  it('dates engagedViews to 2025, not 2026', () => {
    // The spec carried 2026-04-24 for a while — a year late. A registry
    // keyed on effective dates is worth less with a wrong date than none.
    expect(definition('youtube.engagedViews').effectiveFrom).toBe('2025-04-24');
  });

  it('keeps the four Facebook denominators apart', () => {
    const byField = new Map(
      definitionsFor('facebook').map((entry) => [entry.field, entry]),
    );

    expect(byField.get('total_video_impressions')).toMatchObject({
      countsFrom: 'impression',
      isEstimated: true,
    });
    expect(byField.get('blue_reels_play_count')).toMatchObject({
      countsFrom: 'one_millisecond',
      includesReplays: false,
    });
    expect(byField.get('total_video_views')).toMatchObject({
      countsFrom: 'three_seconds',
    });

    const countsFrom = new Set(
      definitionsFor('facebook')
        .filter((entry) => entry.availability === 'organic')
        .map((entry) => entry.countsFrom),
    );

    expect(countsFrom).toEqual(
      new Set([
        'impression',
        'unique_account',
        'one_millisecond',
        'three_seconds',
      ]),
    );
  });

  it('marks ThruPlay ads-only, with no organic field to request', () => {
    const thruPlay = definition('facebook.thruplay');

    expect(thruPlay.availability).toBe('ads_only');
    expect(thruPlay.field).toBeNull();
    expect(thruPlay.surface).toBeNull();
    expect(thruPlay.includesPaid).toBe(true);

    // The only ads-only entry, and nothing organic borrows its name: the
    // 15-second metric is a different rule and must not be labelled ThruPlay.
    expect(
      VIEW_DEFINITIONS.filter((entry) => entry.availability === 'ads_only'),
    ).toEqual([thruPlay]);
    expect(
      VIEW_DEFINITIONS.filter(
        (entry) =>
          entry.availability === 'organic' && /thruplay/i.test(entry.label),
      ),
    ).toEqual([]);
  });

  it('marks the TikTok Business view count as mixing organic and paid', () => {
    expect(definition('tiktok.business.video_views')).toMatchObject({
      field: 'video_views',
      includesPaid: true,
      role: 'concurrent',
    });
    // The Display API count is the one we ingest, and TikTok says nothing
    // about paid there — which is not the same as saying it is excluded.
    expect(definition('tiktok.display.view_count')).toMatchObject({
      role: 'views_column',
      includesPaid: 'undocumented',
    });
  });

  it('marks estimated exactly where the vendor says so', () => {
    const estimated = VIEW_DEFINITIONS.filter(
      (entry) => entry.isEstimated === true,
    )
      .map((entry) => entry.id)
      .sort();

    expect(estimated).toEqual([
      'facebook.post_impressions_unique',
      'facebook.total_video_impressions',
      'instagram.reach',
    ]);
  });

  it('holds two live Instagram view definitions at once', () => {
    // `total_views` did not supersede `views` — since 2026-04-22 both are
    // live, and the aggregate folds in boosted placements and replays.
    expect(definition('instagram.views')).toMatchObject({
      role: 'views_column',
      effectiveFrom: '2025-04-21',
      supersedes: 'instagram.plays',
    });
    expect(definition('instagram.total_views')).toMatchObject({
      role: 'concurrent',
      effectiveFrom: '2026-04-22',
      includesReplays: true,
      includesPaid: true,
    });
    expect(definition('instagram.total_views').supersedes).toBeUndefined();
  });

  it('claims a continuous alternative only where one is defined', () => {
    const claims = VIEW_DEFINITIONS.filter(
      (entry) => entry.continuousAlternative !== undefined,
    );

    // YouTube's `views` chain, and nothing else.
    expect(claims.map((entry) => entry.id).sort()).toEqual([
      'youtube.views.2026-08-27',
      'youtube.views.legacy',
      'youtube.views.shorts.2025-03-31',
    ]);

    for (const entry of claims) {
      expect(entry.continuousAlternative).toBe('engagedViews');
      expect(
        definitionsFor(entry.platform).some(
          (candidate) =>
            candidate.field === entry.continuousAlternative &&
            candidate.supersedes === undefined,
        ),
        `${entry.id} names an alternative with no definition of its own`,
      ).toBe(true);
    }
  });
});

describe('viewDefinitionAt', () => {
  it('returns the unified definition from 2026-08-27 on', () => {
    expect(viewDefinitionAt('youtube', '2026-08-27')).toEqual({
      kind: 'single',
      definition: definition('youtube.views.2026-08-27'),
    });
    expect(viewDefinitionAt('youtube', '2026-09-22')).toEqual({
      kind: 'single',
      definition: definition('youtube.views.2026-08-27'),
    });
  });

  it('says Shorts and other formats disagreed the day before', () => {
    expect(viewDefinitionAt('youtube', '2026-08-26')).toEqual({
      kind: 'by_format',
      shorts: definition('youtube.views.shorts.2025-03-31'),
      other: definition('youtube.views.legacy'),
    });
  });

  it('resolves one definition once the format is known', () => {
    expect(
      viewDefinitionAt('youtube', '2026-08-26', { format: 'shorts' }),
    ).toEqual({
      kind: 'single',
      definition: definition('youtube.views.shorts.2025-03-31'),
    });
    expect(
      viewDefinitionAt('youtube', '2026-08-26', { format: 'other' }),
    ).toEqual({
      kind: 'single',
      definition: definition('youtube.views.legacy'),
    });
  });

  it('returns the legacy definition for every format before 2025-03-31', () => {
    expect(viewDefinitionAt('youtube', '2025-03-30')).toEqual({
      kind: 'single',
      definition: definition('youtube.views.legacy'),
    });
  });

  it('follows Instagram from plays to views', () => {
    expect(viewDefinitionAt('instagram', '2025-04-20')).toEqual({
      kind: 'single',
      definition: definition('instagram.plays'),
    });
    expect(viewDefinitionAt('instagram', '2025-04-21')).toEqual({
      kind: 'single',
      definition: definition('instagram.views'),
    });
  });

  it('refuses to pick one of Facebook’s denominators as "views"', () => {
    const lookup = viewDefinitionAt('facebook', '2026-09-01');

    expect(lookup.kind).toBe('no_single_view_definition');

    if (lookup.kind !== 'no_single_view_definition') return;

    expect(lookup.candidates.map((entry) => entry.field)).toEqual(
      expect.arrayContaining([
        'total_video_impressions',
        'blue_reels_play_count',
        'total_video_views',
      ]),
    );
    // Not a candidate: there is no organic field to read it from.
    expect(lookup.candidates).not.toContain(definition('facebook.thruplay'));
  });

  it('resolves a named field on a platform with no views column', () => {
    expect(
      viewDefinitionAt('facebook', '2026-09-01', {
        field: 'total_video_views',
      }),
    ).toEqual({
      kind: 'single',
      definition: definition('facebook.total_video_views'),
    });
  });

  it('has nothing to say about a field before it existed', () => {
    expect(
      viewDefinitionAt('youtube', '2025-04-23', { field: 'engagedViews' }),
    ).toEqual({ kind: 'not_defined_on_date', definedFrom: '2025-04-24' });
  });

  it('rejects a field the registry does not hold for that platform', () => {
    // `video_views` is TikTok's and X's name. Asking YouTube for it is a
    // caller's mistake, not an absent state to render.
    expect(() =>
      viewDefinitionAt('youtube', '2026-09-01', { field: 'video_views' }),
    ).toThrow(RangeError);
  });

  it('rejects a date it cannot order', () => {
    expect(() => viewDefinitionAt('youtube', '27/08/2026')).toThrow(RangeError);
    expect(() => viewDefinitionAt('youtube', '2026-02-30')).toThrow(RangeError);
  });
});

describe('comparableAcross', () => {
  it('refuses a YouTube range spanning 2026-08-27, and says why', () => {
    const result = comparableAcross('youtube', '2026-08-01', '2026-09-22', {
      format: 'other',
    });

    expect(result).toEqual({
      comparable: false,
      reason: 'view_definition_changed',
      changedOn: '2026-08-27',
      changes: [
        {
          date: '2026-08-27',
          rolloutCompleteBy: '2026-08-27',
          from: definition('youtube.views.legacy'),
          to: definition('youtube.views.2026-08-27'),
        },
      ],
      continuousAlternative: {
        field: 'engagedViews',
        definition: definition('youtube.engagedViews'),
        coversRange: true,
      },
    });
  });

  it('treats the boundary day itself as the new definition', () => {
    // A range ending the day before is wholly old; one starting on the day
    // is wholly new. Only a range holding both sides is refused.
    expect(
      comparableAcross('youtube', '2026-08-01', '2026-08-26', {
        format: 'other',
      }).comparable,
    ).toBe(true);
    expect(
      comparableAcross('youtube', '2026-08-27', '2026-09-22').comparable,
    ).toBe(true);
    expect(
      comparableAcross('youtube', '2026-08-26', '2026-08-27').comparable,
    ).toBe(false);
  });

  it('names the definition a comparable range was measured under', () => {
    expect(comparableAcross('youtube', '2026-08-27', '2026-09-22')).toEqual({
      comparable: true,
      definition: {
        kind: 'single',
        definition: definition('youtube.views.2026-08-27'),
      },
    });
  });

  it('counts the Shorts change against a pooled range, not a long-form one', () => {
    const pooled = comparableAcross('youtube', '2025-03-01', '2025-07-01');
    const longForm = comparableAcross('youtube', '2025-03-01', '2025-07-01', {
      format: 'other',
    });

    expect(pooled).toMatchObject({
      comparable: false,
      changedOn: '2025-03-31',
    });
    expect(longForm.comparable).toBe(true);
  });

  it('refuses a range inside the Shorts rollout window', () => {
    // The API kept the old methodology until the targeted-query and bulk
    // surfaces were updated, so between the effective date and the end of
    // the rollout a stored Shorts view is one definition or the other and
    // nothing says which.
    expect(
      comparableAcross('youtube', '2025-04-10', '2025-05-10', {
        format: 'shorts',
      }),
    ).toMatchObject({ comparable: false, changedOn: '2025-03-31' });
    expect(
      comparableAcross('youtube', '2025-06-24', '2025-12-31', {
        format: 'shorts',
      }).comparable,
    ).toBe(true);
  });

  it('reports every change in a range, earliest first', () => {
    const result = comparableAcross('youtube', '2025-01-01', '2026-09-22');

    expect(result).toMatchObject({ reason: 'view_definition_changed' });

    if (result.comparable || result.reason !== 'view_definition_changed') {
      return;
    }

    expect(result.changedOn).toBe('2025-03-31');
    expect(result.changes.map((change) => change.date)).toEqual([
      '2025-03-31',
      '2026-08-27',
    ]);
  });

  it('offers engagedViews only with the truth about its coverage', () => {
    const result = comparableAcross('youtube', '2025-01-01', '2026-09-22');

    expect(result).toMatchObject({
      continuousAlternative: { field: 'engagedViews', coversRange: false },
    });
  });

  it('finds the same range comparable on a platform with no change in it', () => {
    expect(comparableAcross('tiktok', '2026-08-01', '2026-09-22')).toEqual({
      comparable: true,
      definition: {
        kind: 'single',
        definition: definition('tiktok.display.view_count'),
      },
    });
    expect(
      comparableAcross('instagram', '2026-08-01', '2026-09-22').comparable,
    ).toBe(true);
  });

  it('offers no alternative where the platform has none', () => {
    expect(comparableAcross('instagram', '2025-04-01', '2025-05-01')).toEqual({
      comparable: false,
      reason: 'view_definition_changed',
      changedOn: '2025-04-21',
      changes: [
        {
          date: '2025-04-21',
          rolloutCompleteBy: '2025-04-21',
          from: definition('instagram.plays'),
          to: definition('instagram.views'),
        },
      ],
      continuousAlternative: null,
    });
  });

  it('does not treat a concurrent definition arriving as a change', () => {
    // `total_views` began on 2026-04-22 beside `views`, not instead of it.
    expect(
      comparableAcross('instagram', '2026-04-01', '2026-05-01').comparable,
    ).toBe(true);
  });

  it('will not compare "views" on a platform that has four of them', () => {
    expect(comparableAcross('facebook', '2026-08-01', '2026-09-22')).toEqual({
      comparable: false,
      reason: 'no_single_view_definition',
    });
    expect(
      comparableAcross('facebook', '2026-08-01', '2026-09-22', {
        field: 'total_video_views',
      }).comparable,
    ).toBe(true);
  });

  it('will not compare a series across the day it began', () => {
    expect(
      comparableAcross('youtube', '2025-01-01', '2026-09-22', {
        field: 'engagedViews',
      }),
    ).toEqual({
      comparable: false,
      reason: 'not_defined_for_whole_range',
      definedFrom: '2025-04-24',
    });
  });

  it('is continuous on engagedViews across both YouTube changes', () => {
    expect(
      comparableAcross('youtube', '2025-04-24', '2026-09-22', {
        field: 'engagedViews',
      }).comparable,
    ).toBe(true);
  });

  it('rejects a reversed range', () => {
    expect(() =>
      comparableAcross('youtube', '2026-09-01', '2026-08-01'),
    ).toThrow(RangeError);
  });
});

describe('viewDefinitionChangesBetween', () => {
  it('gives a chart the boundary to mark', () => {
    expect(
      viewDefinitionChangesBetween('youtube', '2026-06-24', '2026-09-22').map(
        (change) => change.date,
      ),
    ).toEqual(['2026-08-27']);
  });

  it('gives a chart nothing to mark where nothing changed', () => {
    expect(
      viewDefinitionChangesBetween('tiktok', '2026-06-24', '2026-09-22'),
    ).toEqual([]);
    expect(
      viewDefinitionChangesBetween('youtube', '2026-08-27', '2026-09-22'),
    ).toEqual([]);
  });
});

describe('field aliases (FILM-1722)', () => {
  it('resolves total_views_count to the same definition as total_views', () => {
    expect(
      viewDefinitionAt('instagram', '2026-05-01', {
        field: 'total_views_count',
      }),
    ).toEqual({
      kind: 'single',
      definition: definition('instagram.total_views'),
    });
  });

  it('resolves the two spellings to the same series across a range', () => {
    expect(
      comparableAcross('instagram', '2026-05-01', '2026-09-01', {
        field: 'total_views_count',
      }),
    ).toEqual(
      comparableAcross('instagram', '2026-05-01', '2026-09-01', {
        field: 'total_views',
      }),
    );
  });
});

describe('viewsDenominatorFor (FILM-1722)', () => {
  it('reads views where the range is one definition', () => {
    const result = viewsDenominatorFor('youtube', '2026-08-28', '2026-09-20');

    expect(result).toMatchObject({ kind: 'column', column: 'views' });
    expect(
      result.kind === 'column' && result.definitions.map((d) => d.id),
    ).toEqual(['youtube.views.2026-08-27']);
  });

  it('reads engaged_views across the 2026-08-27 change, which it covers', () => {
    const result = viewsDenominatorFor('youtube', '2026-08-01', '2026-09-20');

    expect(result).toMatchObject({
      kind: 'column',
      column: 'engaged_views',
      instead: { reason: 'view_definition_changed', changedOn: '2026-08-27' },
    });
    expect(
      result.kind === 'column' && result.definitions.map((d) => d.id),
    ).toEqual(['youtube.engagedViews']);
  });

  it('refuses a range the alternative does not cover, and says from when it does', () => {
    const result = viewsDenominatorFor('youtube', '2025-01-01', '2025-12-01');

    expect(result).toMatchObject({
      kind: 'suppressed',
      reason: 'view_definition_changed',
      changedOn: '2025-03-31',
      continuousAlternative: {
        field: 'engagedViews',
        coversRange: false,
      },
    });
    expect(result).not.toHaveProperty('column');
  });

  it('names both definitions of a pooled YouTube figure between the two changes', () => {
    const result = viewsDenominatorFor('youtube', '2025-07-01', '2025-08-01');

    expect(result).toMatchObject({ kind: 'column', column: 'views' });
    expect(
      result.kind === 'column' && result.definitions.map((d) => d.id),
    ).toEqual(['youtube.views.shorts.2025-03-31', 'youtube.views.legacy']);
  });

  it('refuses Facebook, which has no single view definition', () => {
    expect(viewsDenominatorFor('facebook', '2026-01-01', '2026-02-01')).toEqual(
      { kind: 'suppressed', reason: 'no_single_view_definition' },
    );
  });

  it('reads views on a platform with no change in range', () => {
    expect(
      viewsDenominatorFor('tiktok', '2024-01-01', '2026-09-20'),
    ).toMatchObject({
      kind: 'column',
      column: 'views',
      definitions: [{ id: 'tiktok.display.view_count' }],
    });
  });

  it('never returns a number, and agrees with comparableAcross everywhere', () => {
    const ranges: Array<[string, string]> = [
      ['2024-01-01', '2024-06-01'],
      ['2025-01-01', '2025-12-01'],
      ['2025-04-24', '2025-06-30'],
      ['2025-07-01', '2026-08-26'],
      ['2026-08-01', '2026-09-20'],
      ['2026-08-27', '2026-09-20'],
    ];

    for (const platform of PLATFORM_IDS) {
      for (const [from, to] of ranges) {
        const result = viewsDenominatorFor(platform, from, to);
        const comparability = comparableAcross(platform, from, to);

        expect(
          Object.values(result).some((value) => typeof value === 'number'),
        ).toBe(false);

        if (comparability.comparable) {
          expect(result, `${platform} ${from}..${to}`).toMatchObject({
            kind: 'column',
            column: 'views',
          });
        } else {
          const covered =
            comparability.reason === 'view_definition_changed' &&
            comparability.continuousAlternative?.coversRange === true;

          expect(result.kind, `${platform} ${from}..${to}`).toBe(
            covered ? 'column' : 'suppressed',
          );
        }
      }
    }
  });
});
