/**
 * Seeded randomness. Every run draws a seed and logs it; `SANDBOX_SEED`
 * replays it. Each request gets its own stream, derived from the run's seed
 * and the request's position, so the same seed and the same sequence of
 * requests give byte-identical responses.
 */
export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(probability: number): boolean;
  shuffle<T>(items: readonly T[]): T[];
}

/** mulberry32: small, fast, and good enough for picking realistic content. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (min: number, max: number) =>
    Math.floor(next() * (max - min + 1)) + min;

  return {
    next,
    int,
    float: (min, max) => next() * (max - min) + min,
    pick: <T>(items: readonly T[]) => {
      if (items.length === 0) throw new Error('pick from an empty list');
      return items[int(0, items.length - 1)] as T;
    },
    chance: (probability) => next() < probability,
    shuffle: <T>(items: readonly T[]) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(0, i);
        [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
      }
      return copy;
    },
  };
}

export function drawSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

/** A stream per request: the run's seed mixed with the request's index. */
export function requestRng(seed: number, index: number) {
  return createRng((seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0);
}
