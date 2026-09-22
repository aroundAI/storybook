/**
 * A figure that was measured, or the fact that it was not (KB-16).
 *
 * The Overview cards took optional data and, when it was absent, drew
 * something anyway — a donut that was 83/17 for every account, a revenue
 * split that was `revenue * 0.7`. An optional prop reads the same at the
 * call site whether a default is a computation or a constant, which is how
 * that survived review. So a card takes this instead: `absent` is a case
 * it must render as words, and there is no `value` on it to fall back from.
 */
export type Measured<T> = { kind: 'measured'; value: T } | { kind: 'absent' };

export const ABSENT: Measured<never> = { kind: 'absent' };

export function measured<T>(value: T): Measured<T> {
  return { kind: 'measured', value };
}
