/**
 * The pending-publish badge on the studio sidebar (FILM-901): a project's
 * publishes that are waiting to go out or going out now.
 */
export const PENDING_PUBLISH_STATUSES = [
  'draft',
  'scheduled',
  'queued',
  'publishing',
] as const;

const MAX_DISPLAYED = 99;

export interface PendingPublishBadge {
  label: string;
  ariaLabel: string;
}

/** Nothing for none, `99+` above ninety-nine, and the count read out in full. */
export function pendingPublishBadge(
  count: number | null | undefined,
): PendingPublishBadge | null {
  if (!count || count < 1) return null;

  return {
    label: count > MAX_DISPLAYED ? `${MAX_DISPLAYED}+` : String(count),
    ariaLabel: `${count} pending ${count === 1 ? 'publish' : 'publishes'}`,
  };
}
