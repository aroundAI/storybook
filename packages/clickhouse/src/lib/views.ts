/**
 * Two views figures added, where null means not measured: every row behind
 * it is a platform with no single view (Facebook, KB-153). Measured on
 * either side is measured; a not-measured side adds nothing.
 */
export function addViews(a: number | null, b: number | null): number | null {
  return addMeasured(a, b);
}

/**
 * The same rule for any counter a platform does not measure: X's shares are
 * NULL (FILM-1727, migration 021) as Facebook's views are. One definition.
 */
export function addMeasured(a: number | null, b: number | null): number | null {
  return a === null && b === null ? null : (a ?? 0) + (b ?? 0);
}
