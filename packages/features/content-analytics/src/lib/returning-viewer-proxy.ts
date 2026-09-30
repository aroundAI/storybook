/**
 * The subscribed-versus-not split behind the returning-viewer proxy.
 *
 * Neither YouTube API reports new versus returning viewers, so the share of
 * views that came from subscribers stands in for it. It is a proxy: a
 * subscriber can be a first-time viewer of a video and a returning viewer
 * need not subscribe.
 */
export interface SubscribedSplit {
  subscribedViews: number;
  notSubscribedViews: number;
  /** Null when no audience rows exist: unmeasured is not 0% subscribed. */
  subscribedShare: number | null;
}

export function subscribedSplit(
  rows: readonly { key: string; views: number }[],
): SubscribedSplit {
  let subscribedViews = 0;
  let notSubscribedViews = 0;

  for (const row of rows) {
    if (row.key === 'subscribed') subscribedViews += row.views;
    else notSubscribedViews += row.views;
  }

  const total = subscribedViews + notSubscribedViews;

  return {
    subscribedViews,
    notSubscribedViews,
    subscribedShare: total > 0 ? subscribedViews / total : null,
  };
}
