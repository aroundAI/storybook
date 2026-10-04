import { describe, expect, it } from 'vitest';

import { buildDeliverySummary } from '../src/delivery.service';
import { REPORT } from './delivery-fixtures';

/**
 * A delivered session's summary (FILM-2003): the report is the record of
 * the delivered cut (versions, duration, operations); the events supply the
 * plan and QA counts the report does not hold.
 */
describe('buildDeliverySummary', () => {
  it('takes the cut from the report and the plan and QA counts from the events', () => {
    const summary = buildDeliverySummary(
      [
        {
          id: 1,
          ts: '2026-10-04T10:00:00Z',
          type: 'plan_proposed',
          data: { planId: 'a' },
        },
        {
          id: 2,
          ts: '2026-10-04T10:01:00Z',
          type: 'plan_approved',
          data: { planId: 'a' },
        },
        {
          id: 3,
          ts: '2026-10-04T10:02:00Z',
          type: 'version_created',
          data: { versionId: 'v9', aiOps: 1, userOps: 0, durationSeconds: 10 },
        },
        { id: 4, ts: '2026-10-04T10:03:00Z', type: 'qa_run', data: {} },
        { id: 5, ts: '2026-10-04T10:04:00Z', type: 'qa_run', data: {} },
      ],
      REPORT as never,
    );

    expect(summary).toEqual({
      versions: 2,
      finalDuration: 91.2,
      aiOps: 34,
      userOps: 3,
      plansProposed: 1,
      plansApproved: 1,
      qaRuns: 2,
    });
  });

  it('records a delivery with no events', () => {
    expect(buildDeliverySummary([], REPORT as never)).toMatchObject({
      versions: 2,
      plansProposed: 0,
      qaRuns: 0,
    });
  });
});
