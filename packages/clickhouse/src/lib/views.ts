/**
 * Two figures added, where null means not measured. Measured on either side
 * is measured; a not-measured side adds nothing. Views use it (every row a
 * platform with no single view, Facebook, KB-153), so does estimated
 * revenue (no measured day, FILM-1726), and so do X's shares (NULL,
 * FILM-1727, migration 021).
 */
export function addMeasured(
  a: number | null,
  b: number | null,
): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}

/** `addMeasured`, for a views figure. */
export const addViews = addMeasured;
