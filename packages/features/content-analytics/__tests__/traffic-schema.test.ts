import { describe, expect, it } from 'vitest';

import { TRAFFIC_SOURCE_BUCKETS } from '@kit/clickhouse';

import {
  MAX_BREAKDOWN_SPAN_DAYS,
  ScopeSchema,
  TrafficBreakdownSchema,
} from '../src/lib/schemas/traffic.schema';

const PROJECT = '550e8400-e29b-41d4-a716-446655440000';
const DAY_MS = 86_400_000;

/** A window of exactly `days` length, ending on a fixed date. */
function window(days: number) {
  const to = new Date('2026-06-30T00:00:00.000Z');
  const from = new Date(to.getTime() - days * DAY_MS);

  return { from, to };
}

describe('ScopeSchema', () => {
  it('accepts a project scope', () => {
    expect(ScopeSchema.safeParse({ projectId: PROJECT }).success).toBe(true);
  });

  it('accepts an account scope', () => {
    expect(ScopeSchema.safeParse({ accountId: PROJECT }).success).toBe(true);
  });

  it('rejects a scope naming neither project nor account', () => {
    // The tenant boundary every deep-dive action leans on: the ClickHouse
    // queries carry no predicate of their own beyond the scope conditions,
    // so an empty scope must never reach them.
    const result = ScopeSchema.safeParse({ platform: 'youtube' });

    expect(result.success).toBe(false);

    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        'projectId or accountId is required',
      );
    }
  });

  it('rejects a connection filter with no scope behind it', () => {
    expect(ScopeSchema.safeParse({ connectionId: PROJECT }).success).toBe(
      false,
    );
  });

  it('rejects a non-uuid project id', () => {
    expect(ScopeSchema.safeParse({ projectId: 'the-chronicles' }).success).toBe(
      false,
    );
  });
});

describe('TrafficBreakdownSchema', () => {
  describe('dates', () => {
    it('requires from and to', () => {
      // Absent dates mean all history, which is the unbounded case the span
      // cap exists to prevent — so the cap is only a bound if the dates
      // cannot be omitted.
      const result = TrafficBreakdownSchema.safeParse({
        scope: { projectId: PROJECT },
        bucket: 'week',
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join('.'));

        expect(paths).toContain('from');
        expect(paths).toContain('to');
      }
    });

    it('rejects a window that runs backwards, on the from path', () => {
      const { from, to } = window(30);
      const result = TrafficBreakdownSchema.safeParse({
        scope: { projectId: PROJECT },
        bucket: 'week',
        from: to,
        to: from,
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(['from']);
        expect(result.error.issues[0]?.message).toContain('must not be after');
      }
    });

    it('accepts a window of zero length', () => {
      const { to } = window(0);

      expect(
        TrafficBreakdownSchema.safeParse({
          scope: { projectId: PROJECT },
          bucket: 'day',
          from: to,
          to,
        }).success,
      ).toBe(true);
    });
  });

  describe('span cap', () => {
    // Asserted against the exported constant rather than restated numbers,
    // so raising a cap cannot leave the test passing against the old one.
    for (const bucket of TRAFFIC_SOURCE_BUCKETS) {
      const cap = MAX_BREAKDOWN_SPAN_DAYS[bucket];

      it(`accepts exactly ${cap} days for ${bucket}`, () => {
        const { from, to } = window(cap);

        expect(
          TrafficBreakdownSchema.safeParse({
            scope: { projectId: PROJECT },
            bucket,
            from,
            to,
          }).success,
        ).toBe(true);
      });

      it(`rejects ${cap + 1} days for ${bucket}, on the bucket path`, () => {
        const { from, to } = window(cap + 1);
        const result = TrafficBreakdownSchema.safeParse({
          scope: { projectId: PROJECT },
          bucket,
          from,
          to,
        });

        expect(result.success).toBe(false);

        if (!result.success) {
          expect(result.error.issues[0]?.path).toEqual(['bucket']);
          expect(result.error.issues[0]?.message).toContain(String(cap));
          expect(result.error.issues[0]?.message).toContain(bucket);
        }
      });
    }

    it('caps each granularity independently', () => {
      // A span legal for a month breakdown must not be legal for a day one:
      // capping only the loosest granularity is what the FILM-1605 review
      // found and is the regression this guards.
      const { from, to } = window(MAX_BREAKDOWN_SPAN_DAYS.month);

      expect(
        TrafficBreakdownSchema.safeParse({
          scope: { projectId: PROJECT },
          bucket: 'month',
          from,
          to,
        }).success,
      ).toBe(true);

      expect(
        TrafficBreakdownSchema.safeParse({
          scope: { projectId: PROJECT },
          bucket: 'day',
          from,
          to,
        }).success,
      ).toBe(false);
    });
  });

  describe('bucket', () => {
    it('defaults to week', () => {
      const { from, to } = window(30);
      const result = TrafficBreakdownSchema.safeParse({
        scope: { projectId: PROJECT },
        from,
        to,
      });

      expect(result.success).toBe(true);

      if (result.success) {
        expect(result.data.bucket).toBe('week');
      }
    });

    it('rejects a granularity outside the shared tuple', () => {
      const { from, to } = window(30);

      expect(
        TrafficBreakdownSchema.safeParse({
          scope: { projectId: PROJECT },
          bucket: 'quarter',
          from,
          to,
        }).success,
      ).toBe(false);
    });

    it('has a cap for every granularity the tuple allows', () => {
      // Adding a granularity without a cap would make its span unbounded
      // while every existing test still passed.
      for (const bucket of TRAFFIC_SOURCE_BUCKETS) {
        expect(MAX_BREAKDOWN_SPAN_DAYS[bucket]).toBeGreaterThan(0);
      }

      expect(Object.keys(MAX_BREAKDOWN_SPAN_DAYS).sort()).toEqual(
        [...TRAFFIC_SOURCE_BUCKETS].sort(),
      );
    });
  });

  it('rejects a payload whose scope names neither project nor account', () => {
    const { from, to } = window(30);

    expect(
      TrafficBreakdownSchema.safeParse({
        scope: { platform: 'youtube' },
        bucket: 'week',
        from,
        to,
      }).success,
    ).toBe(false);
  });

  it('coerces ISO date strings, as the action boundary delivers them', () => {
    const result = TrafficBreakdownSchema.safeParse({
      scope: { projectId: PROJECT },
      bucket: 'week',
      from: '2026-01-04',
      to: '2026-06-27',
    });

    expect(result.success).toBe(true);

    if (result.success) {
      expect(result.data.from).toBeInstanceOf(Date);
      expect(result.data.to.toISOString()).toContain('2026-06-27');
    }
  });
});
