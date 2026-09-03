const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/**
 * Labels a cohort key ('YYYY-MM-DD') for its bucket.
 *
 * Parsed with a regex rather than `new Date`. V8 reads a bare 'YYYY-MM-DD'
 * as UTC midnight while `getMonth`/`getFullYear` read local time, so west of
 * UTC every label slid a quarter — '2026-01-01' rendered as "Q4 2025", and
 * the year was wrong at each boundary. This runs in the browser, so unlike
 * the same bug class in video-age.ts it reached real users rather than
 * only a non-UTC laptop.
 */
export function formatCohort(
  cohort: string,
  bucket: 'month' | 'quarter' = 'quarter',
): string {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(cohort);

  if (!match) return cohort;

  const year = match[1]!;
  const monthIndex = Number(match[2]) - 1;

  if (monthIndex < 0 || monthIndex > 11) return cohort;

  return bucket === 'month'
    ? `${MONTH_NAMES[monthIndex]} ${year}`
    : `Q${Math.floor(monthIndex / 3) + 1} ${year}`;
}
