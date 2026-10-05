import { describe, expect, it } from 'vitest';

import { analyseGenome } from '../src/lib/genome';
import type { GenomeVideo } from '../src/lib/genome';
import {
  GENOME_DIMENSION_STAGE,
  TAG_DIMENSIONS,
  editStyleAttributes,
  withEditStyle,
} from '../src/lib/genome-attributes';

/**
 * FILM-2006: edit style from `edit_sessions_fact` joins the content genome
 * as optional dimensions. A video edited in StorybookStudio gains measured
 * attributes; one that was not gains nothing — absent, never a zero band.
 */
const STYLE = {
  cutsPerMinute: 10,
  avgShotLength: 5.625,
  hookType: 'cold-open',
  aiShare: 0.75,
};

const tags = (attributes: { tag: string }[]) =>
  attributes.map((attribute) => attribute.tag).sort();

describe('editStyleAttributes', () => {
  it('bands each measured figure', () => {
    expect(tags(editStyleAttributes(STYLE, []))).toEqual([
      'ai_share:over-75pct',
      'avg_shot_length:4-to-8s',
      'cuts_per_minute:5-to-15',
      'hook_type:cold-open',
    ]);
  });

  it('marks every one as coming from edit_sessions_fact', () => {
    for (const attribute of editStyleAttributes(STYLE, [])) {
      expect(attribute.source).toBe('edit_sessions_fact');
      expect(attribute.layer).toBe('observable');
    }
  });

  it('band edges: the lower edge belongs to the higher band', () => {
    const band = (figures: Partial<typeof STYLE>, dimension: string) =>
      editStyleAttributes(
        {
          cutsPerMinute: null,
          avgShotLength: null,
          hookType: null,
          aiShare: null,
          ...figures,
        },
        [],
      ).find((attribute) => attribute.dimension === dimension)?.value;

    expect(band({ cutsPerMinute: 0 }, 'cuts_per_minute')).toBe('under-5');
    expect(band({ cutsPerMinute: 5 }, 'cuts_per_minute')).toBe('5-to-15');
    expect(band({ cutsPerMinute: 30 }, 'cuts_per_minute')).toBe('over-30');
    expect(band({ avgShotLength: 2 }, 'avg_shot_length')).toBe('2-to-4s');
    expect(band({ avgShotLength: 8 }, 'avg_shot_length')).toBe('over-8s');
    expect(band({ aiShare: 0 }, 'ai_share')).toBe('under-25pct');
    expect(band({ aiShare: 0.25 }, 'ai_share')).toBe('25-to-75pct');
    expect(band({ aiShare: 1 }, 'ai_share')).toBe('over-75pct');
  });

  it('a figure not recorded gives no attribute, not a lowest band', () => {
    expect(
      editStyleAttributes(
        {
          cutsPerMinute: null,
          avgShotLength: null,
          hookType: null,
          aiShare: null,
        },
        [],
      ),
    ).toEqual([]);
    expect(editStyleAttributes(null, [])).toEqual([]);
  });

  it("a hand-recorded hook stays: it is the account's own vocabulary", () => {
    const tagged = [
      {
        kind: 'genome' as const,
        layer: 'observable' as const,
        dimension: 'hook_type' as const,
        value: 'question',
        tag: 'hook_type:question',
        source: 'tag' as const,
      },
    ];

    expect(
      tags(editStyleAttributes(STYLE, tagged)).filter((tag) =>
        tag.startsWith('hook_type:'),
      ),
    ).toEqual([]);
  });

  it('a measured cut density replaces a hand-recorded band', () => {
    const tagged = [
      {
        kind: 'genome' as const,
        layer: 'observable' as const,
        dimension: 'cuts_per_minute' as const,
        value: 'over-30',
        tag: 'cuts_per_minute:over-30',
        source: 'tag' as const,
      },
    ];

    const merged = withEditStyle(tagged, STYLE).filter(
      (attribute) => attribute.dimension === 'cuts_per_minute',
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      tag: 'cuts_per_minute:5-to-15',
      source: 'edit_sessions_fact',
    });
    // and without an edit, the hand band is left alone
    expect(withEditStyle(tagged, null)).toEqual(tagged);
  });

  it('the derived dimensions are never tags', () => {
    expect(TAG_DIMENSIONS).not.toContain('avg_shot_length');
    expect(TAG_DIMENSIONS).not.toContain('ai_share');
    expect(GENOME_DIMENSION_STAGE.avg_shot_length).toBe('attention');
    expect(GENOME_DIMENSION_STAGE.ai_share).toBe('attention');
  });
});

describe('analyseGenome with edit style', () => {
  // Six videos in one stratum; the three with the highest measure were cut
  // fast (over 15 cuts a minute), the three lowest slowly. Typical is the
  // median of 1..6 = 3.5, so winners are 4, 5, 6 and losers 1, 2, 3.
  const video = (value: number, fast: boolean | null): GenomeVideo => ({
    videoId: `v${value}`,
    connectionId: 'c',
    platform: 'youtube',
    formatFamily: 'long_horizontal',
    assetDurationSeconds: 300,
    tags: ['topic:ai'],
    value,
    editStyle:
      fast === null
        ? null
        : {
            cutsPerMinute: fast ? 20 : 3,
            avgShotLength: null,
            hookType: null,
            aiShare: null,
          },
  });

  const analyse = (videos: GenomeVideo[]) =>
    analyseGenome({
      videos,
      stage: 'attention',
      signal: 'average_view_duration',
      checkpointDays: 30,
      control: 'observed',
      provenance: { kind: 'native', platform: 'youtube' } as never,
    });

  it('finds the cut-density band that separates winners from losers', () => {
    const analysis = analyse([
      video(1, false),
      video(2, false),
      video(3, false),
      video(4, true),
      video(5, true),
      video(6, true),
    ]);

    expect(analysis.findings.map((finding) => finding.attribute.tag)).toContain(
      'cuts_per_minute:15-to-30',
    );
  });

  it('videos never edited in the Studio contribute no edit-style attribute', () => {
    const analysis = analyse([1, 2, 3, 4, 5, 6].map((n) => video(n, null)));
    const named = [
      ...analysis.findings.map((finding) => finding.attribute.dimension),
      ...analysis.strata.flatMap((stratum) =>
        stratum.nonFindings.map((nonFinding) => nonFinding.attribute.dimension),
      ),
    ];

    expect(named).not.toContain('cuts_per_minute');
  });
});
