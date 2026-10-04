import { z } from 'zod';

import type { EditEventType } from './edit-events.schema';

/**
 * `edit_sessions.summary` (FILM-2002): what a session did, rolled up from
 * its events by {@link summarizeEditSession} when it closes. FILM-2006's
 * fact table and Edit record page read it.
 */
export const EditSessionSummarySchema = z.object({
  /** Distinct versions created. */
  versions: z.number().int().nonnegative(),
  /** Seconds: the last delivery's duration, else the last version's; null when neither was recorded. */
  finalDuration: z.number().nonnegative().nullable(),
  aiOps: z.number().int().nonnegative(),
  userOps: z.number().int().nonnegative(),
  /** Distinct plans proposed. */
  plansProposed: z.number().int().nonnegative(),
  /** Distinct plans approved. */
  plansApproved: z.number().int().nonnegative(),
  qaRuns: z.number().int().nonnegative(),
});

export type EditSessionSummary = z.infer<typeof EditSessionSummarySchema>;

/** One stored event, as `edit_events` holds it (data already validated on the way in). */
export interface StoredEditEvent {
  id: number;
  ts: string;
  type: EditEventType | string;
  data: unknown;
}

function field(data: unknown, key: string): unknown {
  return data && typeof data === 'object'
    ? (data as Record<string, unknown>)[key]
    : undefined;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Rolls a session's events into its summary. Events are taken in time
 * order, insertion order breaking ties. A version recorded twice (a
 * re-sent event with a new id) counts once, with its last figures.
 */
export function summarizeEditSession(
  events: readonly StoredEditEvent[],
): EditSessionSummary {
  const ordered = [...events].sort(
    (a, b) => Date.parse(a.ts) - Date.parse(b.ts) || a.id - b.id,
  );

  const versions = new Map<string, { aiOps: number; userOps: number }>();
  const proposed = new Set<string>();
  const approved = new Set<string>();
  let qaRuns = 0;
  let lastVersionDuration: number | null = null;
  let deliveredDuration: number | null = null;

  for (const event of ordered) {
    switch (event.type) {
      case 'version_created': {
        const versionId = field(event.data, 'versionId');

        if (typeof versionId !== 'string') break;

        versions.set(versionId, {
          aiOps: num(field(event.data, 'aiOps')) ?? 0,
          userOps: num(field(event.data, 'userOps')) ?? 0,
        });
        lastVersionDuration =
          num(field(event.data, 'durationSeconds')) ?? lastVersionDuration;
        break;
      }
      case 'plan_proposed':
      case 'plan_approved': {
        const planId = field(event.data, 'planId');

        if (typeof planId === 'string') {
          (event.type === 'plan_proposed' ? proposed : approved).add(planId);
        }
        break;
      }
      case 'qa_run':
        qaRuns += 1;
        break;
      case 'delivered':
        deliveredDuration =
          num(field(event.data, 'durationSeconds')) ?? deliveredDuration;
        break;
    }
  }

  let aiOps = 0;
  let userOps = 0;

  for (const version of versions.values()) {
    aiOps += version.aiOps;
    userOps += version.userOps;
  }

  return {
    versions: versions.size,
    finalDuration: deliveredDuration ?? lastVersionDuration,
    aiOps,
    userOps,
    plansProposed: proposed.size,
    plansApproved: approved.size,
    qaRuns,
  };
}
