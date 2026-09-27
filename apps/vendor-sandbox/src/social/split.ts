import type { Rng } from '../rng';

/**
 * Splitting a whole figure across categories (a report's countries, ages,
 * traffic sources) so the parts are whole numbers that add up to it
 * exactly: largest remainder. A breakdown that did not sum to its total
 * would be a sandbox bug the app is then asked to explain.
 */
export function splitInteger(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, w) => a + w, 0);
  if (total <= 0 || sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (total * w) / sum);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((a, v) => a + v, 0);

  const order = exact
    .map((value, i) => ({ i, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

  for (const { i } of order) {
    if (left <= 0) break;
    floors[i]! += 1;
    left -= 1;
  }
  return floors;
}

/**
 * Weights for a category list: a few large, a long tail, reordered per
 * object so no two objects share one audience. Stable for a given rng.
 */
export function drawWeights(rng: Rng, count: number, concentration = 1.3) {
  return rng
    .shuffle(Array.from({ length: count }, (_, i) => i))
    .map((rank) => 1 / (rank + 1) ** concentration * (0.75 + rng.next() * 0.5));
}

/** Percentages that sum to exactly 100 at two decimals. */
export function percentages(weights: readonly number[]) {
  return splitInteger(10_000, weights).map((basisPoints) => basisPoints / 100);
}
