import { describe, expect, it } from 'vitest';

import { genomeViewsDenominator } from '../src/lib/genome-measures';

/**
 * FILM-1717. A genome rate divides by views, and a cohort spanning a change
 * in what a view is would mix two denominators: later videos read lower on
 * nothing but the definition. The series is FILM-1722's choice, over the
 * dates the cohort's checkpoint windows span.
 */
const base = {
  platform: 'youtube' as const,
  formatFamily: 'long_horizontal' as const,
  measure: 'share_rate' as const,
  checkpointDays: 30,
  asOf: '2026-10-02 00:00:00',
};

describe('genomeViewsDenominator', () => {
  it('keeps views for a cohort on one definition', () => {
    expect(
      genomeViewsDenominator({
        ...base,
        publishedAt: ['2026-01-01 00:00:00', '2026-03-01 00:00:00'],
      }),
    ).toEqual({
      ok: true,
      column: 'views',
      publishedFrom: null,
      instead: null,
    });
  });

  it('reads engaged views across YouTube’s 2026-08-27 change', () => {
    const chosen = genomeViewsDenominator({
      ...base,
      publishedAt: ['2026-06-01 00:00:00', '2026-09-01 00:00:00'],
    });

    expect(chosen).toMatchObject({
      ok: true,
      column: 'engaged_views',
      publishedFrom: null,
      instead: { changedOn: '2026-08-27' },
    });
  });

  it('counts a window that runs into the change, not only the publication date', () => {
    // Published four days before the change: its 30 days cross it.
    expect(
      genomeViewsDenominator({
        ...base,
        publishedAt: ['2026-08-23 00:00:00'],
      }),
    ).toMatchObject({ column: 'engaged_views' });
  });

  it('starts the cohort where engaged views begin when they cannot cover it', () => {
    expect(
      genomeViewsDenominator({
        ...base,
        publishedAt: ['2025-01-10 00:00:00', '2026-09-01 00:00:00'],
      }),
    ).toMatchObject({
      ok: true,
      column: 'engaged_views',
      publishedFrom: '2025-04-24',
    });
  });

  it('refuses, naming the change, when no stored series bridges it', () => {
    // Instagram's plays became views on 2025-04-21; nothing continuous is kept.
    expect(
      genomeViewsDenominator({
        ...base,
        platform: 'instagram',
        formatFamily: 'short_vertical',
        publishedAt: ['2025-03-01 00:00:00', '2025-06-01 00:00:00'],
      }),
    ).toMatchObject({
      ok: false,
      refusal: { kind: 'view_definition_changed', changedOn: '2025-04-21' },
    });
  });

  it('leaves a measure that does not divide by views on views', () => {
    expect(
      genomeViewsDenominator({
        ...base,
        measure: 'impressions_ctr',
        publishedAt: ['2026-06-01 00:00:00', '2026-09-01 00:00:00'],
      }),
    ).toEqual({
      ok: true,
      column: 'views',
      publishedFrom: null,
      instead: null,
    });
  });
});
