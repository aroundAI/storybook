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

/** One upload month of the subscribed-versus-not split, as the query returns it. */
export interface UploadMonthSplit {
  /** First day of the upload month, `YYYY-MM-DD`. */
  month: string;
  videoCount: number;
  videosWithSplit: number;
  subscribedViews: number;
  notSubscribedViews: number;
}

export interface SubscribedShareMonth extends UploadMonthSplit {
  /** Null when the month has no measurable views: a gap, not 0% subscribed. */
  subscribedShare: number | null;
}

function nextMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];

  return new Date(Date.UTC(year, monthNumber, 1)).toISOString().slice(0, 10);
}

/**
 * The share per upload month, every month from the first to the last present,
 * so a month with no uploads is a null gap in the series rather than a
 * missing point that a chart would join across.
 */
export function subscribedShareSeries(
  months: readonly UploadMonthSplit[],
): SubscribedShareMonth[] {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  if (!first || !last) return [];

  const byMonth = new Map(sorted.map((row) => [row.month, row]));
  const series: SubscribedShareMonth[] = [];

  for (let month = first.month; month <= last.month; month = nextMonth(month)) {
    const row = byMonth.get(month) ?? {
      month,
      videoCount: 0,
      videosWithSplit: 0,
      subscribedViews: 0,
      notSubscribedViews: 0,
    };
    const total = row.subscribedViews + row.notSubscribedViews;

    series.push({
      ...row,
      subscribedShare: total > 0 ? row.subscribedViews / total : null,
    });
  }

  return series;
}

export interface TrendPoint {
  month: string;
  x: number;
  y: number;
}

/**
 * Runs of consecutive measurable months, laid out in a `width` by `height`
 * box with 100% at the top. A null month ends the run, so the drawn line
 * breaks at a gap and never interpolates across it.
 */
export function measurableRuns(
  series: readonly SubscribedShareMonth[],
  width: number,
  height: number,
): TrendPoint[][] {
  const runs: TrendPoint[][] = [];
  let current: TrendPoint[] = [];

  series.forEach((entry, index) => {
    if (entry.subscribedShare === null) {
      if (current.length > 0) runs.push(current);
      current = [];
      return;
    }

    current.push({
      month: entry.month,
      x: series.length > 1 ? (index / (series.length - 1)) * width : width / 2,
      y: height - entry.subscribedShare * height,
    });
  });

  if (current.length > 0) runs.push(current);

  return runs;
}
