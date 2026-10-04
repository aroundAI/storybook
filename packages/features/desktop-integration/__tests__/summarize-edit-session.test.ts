import { describe, expect, it } from 'vitest';

import {
  EditSessionSummarySchema,
  type StoredEditEvent,
  summarizeEditSession,
} from '../src';

/**
 * A fixture session: two AI plans (one approved, one rejected), a hand
 * edit, two versions (v2 re-sent under a new event id), three QA runs and a
 * delivery. Hand-computed: versions 2 (v1, v2), aiOps 12 + 30 = 42, userOps
 * 0 + 3 = 3, plansProposed 2, plansApproved 1, qaRuns 3, finalDuration from
 * the delivery (90.4), not v2's 91.2.
 */
const fixture: StoredEditEvent[] = [
  {
    id: 1,
    ts: '2026-10-04T10:00:00Z',
    type: 'plan_proposed',
    data: { planId: 'p1', by: 'ai', steps: 12 },
  },
  {
    id: 2,
    ts: '2026-10-04T10:00:05Z',
    type: 'plan_approved',
    data: { planId: 'p1', versionId: 'v1' },
  },
  {
    id: 3,
    ts: '2026-10-04T10:00:09Z',
    type: 'version_created',
    data: { versionId: 'v1', durationSeconds: 120, aiOps: 12, userOps: 0 },
  },
  {
    id: 4,
    ts: '2026-10-04T10:01:00Z',
    type: 'qa_run',
    data: { pass: false, issues: 2 },
  },
  {
    id: 5,
    ts: '2026-10-04T10:02:00Z',
    type: 'plan_proposed',
    data: { planId: 'p2', by: 'ai', steps: 30 },
  },
  {
    id: 6,
    ts: '2026-10-04T10:02:10Z',
    type: 'plan_rejected',
    data: { planId: 'p2' },
  },
  // the same plan proposed again (a re-sent event) counts once
  {
    id: 7,
    ts: '2026-10-04T10:02:11Z',
    type: 'plan_proposed',
    data: { planId: 'p2', by: 'ai', steps: 30 },
  },
  {
    id: 8,
    ts: '2026-10-04T10:03:00Z',
    type: 'version_created',
    data: { versionId: 'v2', durationSeconds: 91.0, aiOps: 30, userOps: 3 },
  },
  {
    id: 9,
    ts: '2026-10-04T10:03:01Z',
    type: 'version_created',
    data: { versionId: 'v2', durationSeconds: 91.2, aiOps: 30, userOps: 3 },
  },
  {
    id: 10,
    ts: '2026-10-04T10:04:00Z',
    type: 'qa_run',
    data: { pass: true, issues: 0 },
  },
  {
    id: 11,
    ts: '2026-10-04T10:05:00Z',
    type: 'qa_run',
    data: { pass: true, issues: 0 },
  },
  {
    id: 12,
    ts: '2026-10-04T10:06:00Z',
    type: 'delivered',
    data: { renderIds: [], durationSeconds: 90.4 },
  },
];

describe('summarizeEditSession (FILM-2002)', () => {
  it('rolls a fixture event stream into the hand-computed summary', () => {
    expect(summarizeEditSession(fixture)).toEqual({
      versions: 2,
      finalDuration: 90.4,
      aiOps: 42,
      userOps: 3,
      plansProposed: 2,
      plansApproved: 1,
      qaRuns: 3,
    });
  });

  it('gives the same answer whatever order the events arrive in', () => {
    expect(summarizeEditSession([...fixture].reverse())).toEqual(
      summarizeEditSession(fixture),
    );
  });

  it('falls back to the last version’s duration when nothing was delivered', () => {
    const undelivered = fixture.filter((event) => event.type !== 'delivered');

    expect(summarizeEditSession(undelivered).finalDuration).toBe(91.2);
  });

  it('summarises an empty session as zeros and no duration', () => {
    expect(summarizeEditSession([])).toEqual({
      versions: 0,
      finalDuration: null,
      aiOps: 0,
      userOps: 0,
      plansProposed: 0,
      plansApproved: 0,
      qaRuns: 0,
    });
  });

  it('produces what EditSessionSummarySchema accepts', () => {
    expect(
      EditSessionSummarySchema.safeParse(summarizeEditSession(fixture)).success,
    ).toBe(true);
  });
});
