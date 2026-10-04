import { describe, expect, it } from 'vitest';

import { deriveEditStyle } from '../src/lib/edit-style';

/**
 * FILM-2006: edit style from a delivered session's summary. FILM-2003's
 * deliver_edit stores the summary with the report inside it; the Studio's
 * report carries `style {shotCount, hookType}` (lead decision 22:50).
 * Every expected figure is worked out by hand in the comment beside it.
 */
const REPORT = {
  versions: [
    {
      id: 'v1',
      label: 'Rough cut',
      parentId: null,
      createdAt: '2026-10-04T10:00:00Z',
      origin: 'rough_cut',
    },
    {
      id: 'v2',
      label: 'AI cut',
      parentId: 'v1',
      createdAt: '2026-10-04T10:05:00Z',
      origin: 'ai',
    },
  ],
  finalDuration: 90,
  aiOps: 12,
  userOps: 4,
  explain: { targetDuration: 95, scenes: [] },
  style: { shotCount: 16, hookType: 'cold-open' },
};

const SUMMARY = {
  versions: 2,
  finalDuration: 90,
  aiOps: 12,
  userOps: 4,
  plansProposed: 3,
  plansApproved: 2,
  qaRuns: 1,
  report: REPORT,
  qa: { pass: true, issues: [] },
  renders: [],
  primaryRenderId: '00000000-0000-4000-8000-000000000001',
};

describe('deriveEditStyle', () => {
  it('derives cut count, shot length, cut density, hook and AI share from the report', () => {
    const style = deriveEditStyle({ summary: SUMMARY });

    expect(style).toEqual({
      finalDuration: 90,
      targetDuration: 95,
      versions: 2,
      aiOps: 12,
      userOps: 4,
      plansProposed: 3,
      plansApproved: 2,
      // 16 shots → 15 cuts
      cutCount: 15,
      // 90 s / 16 shots
      avgShotLength: 5.625,
      // 15 cuts over 1.5 minutes
      cutsPerMinute: 10,
      hookType: 'cold-open',
      // 12 / (12 + 4)
      aiShare: 0.75,
    });
  });

  it('is null for a summary with no report: not a delivered session', () => {
    expect(deriveEditStyle({ summary: { versions: 1, aiOps: 0 } })).toBeNull();
    expect(deriveEditStyle({ summary: {} })).toBeNull();
    expect(deriveEditStyle({ summary: null })).toBeNull();
  });

  it('a report without style gives null cut figures and hook, never 0', () => {
    const { style: _style, ...withoutStyle } = REPORT;
    const style = deriveEditStyle({
      summary: { ...SUMMARY, report: withoutStyle },
    });

    expect(style).not.toBeNull();
    expect(style!.cutCount).toBeNull();
    expect(style!.avgShotLength).toBeNull();
    expect(style!.cutsPerMinute).toBeNull();
    expect(style!.hookType).toBeNull();
    // what the report does carry still comes through
    expect(style!.finalDuration).toBe(90);
    expect(style!.aiShare).toBe(0.75);
  });

  it('one shot is no cut at all, and a zero-length cut has no density', () => {
    const single = deriveEditStyle({
      summary: {
        ...SUMMARY,
        report: { ...REPORT, style: { shotCount: 1, hookType: null } },
      },
    });

    expect(single!.cutCount).toBe(0);
    expect(single!.avgShotLength).toBe(90);
    expect(single!.cutsPerMinute).toBe(0);
    expect(single!.hookType).toBeNull();

    const empty = deriveEditStyle({
      summary: {
        ...SUMMARY,
        finalDuration: 0,
        report: { ...REPORT, finalDuration: 0 },
      },
    });

    expect(empty!.avgShotLength).toBeNull();
    expect(empty!.cutsPerMinute).toBeNull();
  });

  it('no operations at all is an unknown AI share, not 0% or 100%', () => {
    const style = deriveEditStyle({
      summary: {
        ...SUMMARY,
        aiOps: 0,
        userOps: 0,
        report: { ...REPORT, aiOps: 0, userOps: 0 },
      },
    });

    expect(style!.aiShare).toBeNull();
  });

  it("falls back to the episode's target when the report names none", () => {
    const style = deriveEditStyle({
      summary: {
        ...SUMMARY,
        report: { ...REPORT, explain: { scenes: [] } },
      },
      episodeTargetDurationSeconds: 120,
    });

    expect(style!.targetDuration).toBe(120);
    expect(
      deriveEditStyle({
        summary: { ...SUMMARY, report: { ...REPORT, explain: { scenes: [] } } },
      })!.targetDuration,
    ).toBeNull();
  });

  it('refuses a hook that is not a genome slug rather than storing free text', () => {
    const style = deriveEditStyle({
      summary: {
        ...SUMMARY,
        report: {
          ...REPORT,
          style: { shotCount: 16, hookType: 'Cold Open!' },
        },
      },
    });

    expect(style!.hookType).toBeNull();
    expect(style!.cutCount).toBe(15);
  });

  it('plan counts absent from an older summary are unknown, not 0', () => {
    const { plansProposed: _p, plansApproved: _a, ...older } = SUMMARY;
    const style = deriveEditStyle({ summary: older });

    expect(style!.plansProposed).toBeNull();
    expect(style!.plansApproved).toBeNull();
  });
});
