/**
 * FILM-2213. A scheduled post's time changes in place, and each change is
 * kept on the post: `publishes.metadata.scheduleHistory`, oldest first.
 * `metadata.manualTime` marks a time the owner chose past the channel's
 * posting rules, which a re-plan leaves where it is.
 *
 * Environment-free: the Schedule page, the MCP tools and the digest read it.
 */

export type ScheduleChangeVia = 'ui' | 'mcp' | 'replan';

export interface ScheduleHistoryEntry {
  /** When it was due before the change */
  from: string;
  /** When it is due after it */
  to: string;
  /** When the change was made */
  at: string;
  /** The user who made it */
  by: string | null;
  via: ScheduleChangeVia;
  note: string | null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

const VIA = new Set<string>(['ui', 'mcp', 'replan']);

export function scheduleHistoryOf(metadata: unknown): ScheduleHistoryEntry[] {
  const history = record(metadata).scheduleHistory;
  if (!Array.isArray(history)) return [];

  return history.flatMap((value) => {
    const entry = record(value);

    if (
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string' ||
      typeof entry.at !== 'string'
    ) {
      return [];
    }

    return [
      {
        from: entry.from,
        to: entry.to,
        at: entry.at,
        by: typeof entry.by === 'string' ? entry.by : null,
        via: (VIA.has(String(entry.via))
          ? entry.via
          : 'ui') as ScheduleChangeVia,
        note: typeof entry.note === 'string' ? entry.note : null,
      },
    ];
  });
}

export function manualTimeOf(metadata: unknown) {
  return record(metadata).manualTime === true;
}

/** The changes made between `since` and `until` */
export function movesWithin(
  history: readonly ScheduleHistoryEntry[],
  since: Date,
  until: Date,
) {
  return history.filter((entry) => {
    const at = Date.parse(entry.at);
    return at >= since.getTime() && at < until.getTime();
  });
}
