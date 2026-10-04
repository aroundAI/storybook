import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DeliveryPackageSchema,
  ExplainWhyReportSchema,
  FinalizeRenderSchema,
  HOOK_TYPE_SLUG,
  MAX_RENDER_BYTES,
  QaResultSchema,
  RENDER_PRESET_NAMES,
  RenderPresetSchema,
  RequestRenderUploadSchema,
  isVerticalRender,
  presetAllowsAspect,
} from '../src';
import { REPORT } from './delivery-fixtures';

const SESSION = '0f8b1f8e-6b0a-4d47-9a39-6a3c1f5b2a11';
const RENDER_A = '6f1e2d3c-4b5a-4968-8776-5544332211aa';
const RENDER_B = '6f1e2d3c-4b5a-4968-8776-5544332211bb';

export const QA_PASS = { pass: true, issues: [] };

const QA_FAIL = {
  pass: false,
  issues: [
    {
      type: 'loudness',
      severity: 0.6,
      timeRange: null,
      scene: null,
      detail: 'Integrated loudness -9 LUFS, target -14',
      repairIntent: 'normalize_loudness',
    },
    {
      type: 'black_frames',
      severity: 0.3,
      timeRange: { start: 41, end: 41.5 },
      scene: 3,
      detail: '12 black frames',
    },
  ],
};

describe('render presets', () => {
  it('is the fixed list of six', () => {
    expect([...RENDER_PRESET_NAMES].sort()).toEqual(
      [
        'master',
        'reels_9x16',
        'shorts_9x16',
        'square_1x1',
        'tiktok_9x16',
        'youtube_16x9',
      ].sort(),
    );
  });

  it('refuses a preset outside the list', () => {
    expect(RenderPresetSchema.safeParse('instagram_4x5').success).toBe(false);
    expect(RenderPresetSchema.safeParse('youtube_16x9').success).toBe(true);
  });

  it('binds each preset to its aspect, master to any', () => {
    expect(presetAllowsAspect('youtube_16x9', '16:9')).toBe(true);
    expect(presetAllowsAspect('youtube_16x9', '9:16')).toBe(false);
    expect(presetAllowsAspect('tiktok_9x16', '9:16')).toBe(true);
    expect(presetAllowsAspect('square_1x1', '16:9')).toBe(false);
    expect(presetAllowsAspect('master', '9:16')).toBe(true);
  });

  it('calls only 9:16 vertical', () => {
    expect(isVerticalRender({ aspect: '9:16' })).toBe(true);
    expect(isVerticalRender({ aspect: '16:9' })).toBe(false);
    expect(isVerticalRender({ aspect: '1:1' })).toBe(false);
  });
});

describe('RequestRenderUploadSchema', () => {
  const valid = {
    sessionId: SESSION,
    preset: 'youtube_16x9',
    aspect: '16:9',
    bytes: 48_211,
    contentType: 'video/mp4',
  };

  it('accepts a render and defaults the language to en', () => {
    const parsed = RequestRenderUploadSchema.parse(valid);
    expect(parsed.language).toBe('en');
  });

  it('refuses another container, a zero size and a size over the bucket limit', () => {
    expect(
      RequestRenderUploadSchema.safeParse({
        ...valid,
        contentType: 'video/webm',
      }).success,
    ).toBe(false);
    expect(
      RequestRenderUploadSchema.safeParse({ ...valid, bytes: 0 }).success,
    ).toBe(false);
    expect(
      RequestRenderUploadSchema.safeParse({
        ...valid,
        bytes: MAX_RENDER_BYTES + 1,
      }).success,
    ).toBe(false);
  });

  it('takes a thumbnail image and WebVTT captions, nothing else', () => {
    expect(
      RequestRenderUploadSchema.safeParse({
        ...valid,
        thumbnail: { bytes: 10, contentType: 'image/jpeg' },
        captions: { bytes: 10, contentType: 'text/vtt' },
      }).success,
    ).toBe(true);
    expect(
      RequestRenderUploadSchema.safeParse({
        ...valid,
        captions: { bytes: 10, contentType: 'application/x-subrip' },
      }).success,
    ).toBe(false);
  });

  it('refuses a language that is not a tag', () => {
    expect(
      RequestRenderUploadSchema.safeParse({ ...valid, language: '../en' })
        .success,
    ).toBe(false);
    expect(
      RequestRenderUploadSchema.safeParse({ ...valid, language: 'pt-BR' })
        .success,
    ).toBe(true);
  });
});

describe('QaResultSchema', () => {
  it('accepts a pass and a fail with issues', () => {
    expect(QaResultSchema.safeParse(QA_PASS).success).toBe(true);
    expect(QaResultSchema.safeParse(QA_FAIL).success).toBe(true);
  });

  it('refuses a severity outside 0-1, a backwards range and an unknown repair intent', () => {
    const issue = QA_FAIL.issues[1]!;

    for (const bad of [
      { ...issue, severity: 1.5 },
      { ...issue, timeRange: { start: 5, end: 4 } },
      { ...issue, repairIntent: 'make_it_better' },
      { ...issue, scene: 0 },
    ]) {
      expect(
        QaResultSchema.safeParse({ pass: false, issues: [bad] }).success,
      ).toBe(false);
    }
  });
});

describe('ExplainWhyReportSchema', () => {
  it('accepts the PRD example', () => {
    expect(ExplainWhyReportSchema.safeParse(REPORT).success).toBe(true);
  });

  it('refuses a report with no versions, a negative duration or an unknown change', () => {
    expect(
      ExplainWhyReportSchema.safeParse({ ...REPORT, versions: [] }).success,
    ).toBe(false);
    expect(
      ExplainWhyReportSchema.safeParse({ ...REPORT, finalDuration: -1 })
        .success,
    ).toBe(false);
    expect(
      ExplainWhyReportSchema.safeParse({
        ...REPORT,
        explain: {
          scenes: [
            {
              scene: 1,
              durationBefore: 1,
              durationAfter: 1,
              changes: [
                { action: 'deleted', target: 'x', reason: 'y', by: 'ai' },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('takes an optional style block: a report without one still validates', () => {
    expect(ExplainWhyReportSchema.parse(REPORT).style).toBeUndefined();
    expect(
      ExplainWhyReportSchema.safeParse({
        ...REPORT,
        style: { shotCount: 24, hookType: 'cold-open' },
      }).success,
    ).toBe(true);
    expect(
      ExplainWhyReportSchema.safeParse({
        ...REPORT,
        style: { shotCount: 24, hookType: null },
      }).success,
    ).toBe(true);
  });

  it('refuses a style with no shots or a hook type that is not a slug', () => {
    for (const style of [
      { shotCount: 0, hookType: 'cold-open' },
      { shotCount: 2.5, hookType: 'cold-open' },
      { shotCount: 24, hookType: 'Cold Open' },
      { shotCount: 24 },
    ]) {
      expect(
        ExplainWhyReportSchema.safeParse({ ...REPORT, style }).success,
      ).toBe(false);
    }
  });

  it("uses the content genome's hook_type slug rule", () => {
    const taxonomy = readFileSync(
      path.resolve(
        __dirname,
        '../../content-analytics/src/lib/schemas/taxonomy.schema.ts',
      ),
      'utf8',
    );
    const rule = /const SlugSchema = z[\s\S]*?\.regex\(\s*(\/[^\n]*\/),/.exec(
      taxonomy,
    )?.[1];

    expect(rule).toBe(String(HOOK_TYPE_SLUG));
  });

  it('requires explain.scenes', () => {
    expect(
      ExplainWhyReportSchema.safeParse({ ...REPORT, explain: {} }).success,
    ).toBe(false);
  });
});

describe('FinalizeRenderSchema', () => {
  it('needs a positive duration and a QA result', () => {
    expect(
      FinalizeRenderSchema.safeParse({
        renderId: RENDER_A,
        durationSeconds: 91.2,
        qa: QA_PASS,
      }).success,
    ).toBe(true);
    expect(
      FinalizeRenderSchema.safeParse({
        renderId: RENDER_A,
        durationSeconds: 0,
        qa: QA_PASS,
      }).success,
    ).toBe(false);
    expect(
      FinalizeRenderSchema.safeParse({ renderId: RENDER_A, durationSeconds: 1 })
        .success,
    ).toBe(false);
  });
});

describe('DeliveryPackageSchema', () => {
  const valid = {
    sessionId: SESSION,
    episodeVersion: 14,
    renders: [
      {
        renderId: RENDER_A,
        preset: 'youtube_16x9',
        language: 'en',
        primary: true,
      },
      { renderId: RENDER_B, preset: 'shorts_9x16', language: 'en' },
    ],
    report: REPORT,
    qa: QA_PASS,
  };

  it('accepts the PRD delivery package', () => {
    expect(DeliveryPackageSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses no primary, two primaries and a render listed twice', () => {
    const none = {
      ...valid,
      renders: valid.renders.map((render) => ({ ...render, primary: false })),
    };
    const two = {
      ...valid,
      renders: valid.renders.map((render) => ({ ...render, primary: true })),
    };
    const twice = {
      ...valid,
      renders: [valid.renders[0], { ...valid.renders[0], primary: false }],
    };

    for (const bad of [none, two, twice]) {
      expect(DeliveryPackageSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('refuses an empty render list and a missing episode version', () => {
    expect(
      DeliveryPackageSchema.safeParse({ ...valid, renders: [] }).success,
    ).toBe(false);
    expect(
      DeliveryPackageSchema.safeParse({ ...valid, episodeVersion: undefined })
        .success,
    ).toBe(false);
  });

  it('refuses a report that is not an explain-why report', () => {
    expect(
      DeliveryPackageSchema.safeParse({ ...valid, report: { text: 'done' } })
        .success,
    ).toBe(false);
  });
});
