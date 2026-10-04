import { describe, expect, it } from 'vitest';

import {
  EDIT_EVENT_TYPES,
  EditEventBatchSchema,
  EditEventSchema,
  MAX_EDIT_EVENTS_PER_CALL,
  isEditingInStudio,
  parseEditState,
} from '../src';

const ts = '2026-10-04T10:00:00Z';

const valid = {
  plan_proposed: {
    planId: 'plan-1',
    by: 'ai',
    intent: 'hit_duration',
    steps: 7,
  },
  plan_approved: { planId: 'plan-1', versionId: 'v2' },
  plan_rejected: { planId: 'plan-2', reason: 'too short' },
  version_created: {
    versionId: 'v2',
    durationSeconds: 91.2,
    aiOps: 34,
    userOps: 3,
  },
  qa_run: { pass: true, issues: 0, versionId: 'v2' },
  delivered: {
    renderIds: ['6f9619ff-8b86-4d01-b42d-00cf4fc964ff'],
    durationSeconds: 91.2,
  },
} as const;

/** One malformed `data` per type: a required field missing or mistyped. */
const invalid = {
  plan_proposed: { planId: 'plan-1', by: 'robot', steps: 7 },
  plan_approved: {},
  plan_rejected: { planId: '' },
  version_created: {
    versionId: 'v2',
    durationSeconds: -1,
    aiOps: 1,
    userOps: 0,
  },
  qa_run: { pass: 'yes', issues: 0 },
  delivered: { renderIds: ['not-a-uuid'] },
} as const;

function event(type: string, data: unknown, n = 1) {
  return { clientEventId: `e-${n}`, ts, type, data };
}

describe('edit event schemas (FILM-2002)', () => {
  it('names the six event types the edit_events CHECK allows', () => {
    expect(EDIT_EVENT_TYPES).toEqual([
      'plan_proposed',
      'plan_approved',
      'plan_rejected',
      'version_created',
      'qa_run',
      'delivered',
    ]);
  });

  it.each(EDIT_EVENT_TYPES)('accepts well-formed %s data', (type) => {
    expect(EditEventSchema.safeParse(event(type, valid[type])).success).toBe(
      true,
    );
  });

  it.each(EDIT_EVENT_TYPES)('refuses malformed %s data', (type) => {
    expect(EditEventSchema.safeParse(event(type, invalid[type])).success).toBe(
      false,
    );
  });

  it.each(EDIT_EVENT_TYPES)(
    'refuses a field %s data does not name (strict)',
    (type) => {
      const data = { ...valid[type], extra: 1 };

      expect(EditEventSchema.safeParse(event(type, data)).success).toBe(false);
    },
  );

  it('refuses another type’s data under a type', () => {
    expect(
      EditEventSchema.safeParse(event('qa_run', valid.version_created)).success,
    ).toBe(false);
  });

  it('refuses an unknown type', () => {
    expect(EditEventSchema.safeParse(event('session_opened', {})).success).toBe(
      false,
    );
  });

  it('refuses a timestamp that is not ISO 8601', () => {
    expect(
      EditEventSchema.safeParse({ ...event('qa_run', valid.qa_run), ts: 'now' })
        .success,
    ).toBe(false);
  });

  it('accepts a batch of 500 and refuses 501', () => {
    const batch = (n: number) =>
      Array.from({ length: n }, (_, i) => event('qa_run', valid.qa_run, i));

    expect(MAX_EDIT_EVENTS_PER_CALL).toBe(500);
    expect(EditEventBatchSchema.safeParse(batch(500)).success).toBe(true);

    const refused = EditEventBatchSchema.safeParse(batch(501));
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.message).toBe(
      'At most 500 events per call',
    );
  });

  it('refuses an empty batch', () => {
    expect(EditEventBatchSchema.safeParse([]).success).toBe(false);
  });
});

describe('edit state', () => {
  const sessionId = '6f9619ff-8b86-4d01-b42d-00cf4fc964ff';

  it('reads {} as no edit state', () => {
    expect(parseEditState({})).toEqual({
      sessionId: null,
      editedBy: null,
      since: null,
      lastDeliveredAt: null,
      editedIn: 'studio',
      versions: 0,
    });
  });

  it('shows the badge only while editing with a session named', () => {
    const editState = {
      sessionId,
      editedBy: { userId: sessionId, name: 'Maya' },
      since: ts,
      editedIn: 'studio',
      versions: 0,
      lastDeliveredAt: null,
    };

    expect(
      isEditingInStudio({ status: 'editing', edit_state: editState }),
    ).toBe(true);
    expect(isEditingInStudio({ status: 'ready', edit_state: editState })).toBe(
      false,
    );
    expect(
      isEditingInStudio({
        status: 'editing',
        edit_state: { ...editState, sessionId: null },
      }),
    ).toBe(false);
  });
});
