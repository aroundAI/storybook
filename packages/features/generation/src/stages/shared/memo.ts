import type { Ctx } from '../../types';

const store = new WeakMap<Ctx, Map<string, Promise<unknown>>>();

/**
 * One load per run: `parts`, every `prepare` and `commit` read the same
 * target rows, and a multi-part stage would otherwise re-read them per
 * part. Keyed on the Ctx object, which a runner creates per run.
 */
export function memoised<T>(
  ctx: Ctx,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let byKey = store.get(ctx);

  if (!byKey) {
    byKey = new Map();
    store.set(ctx, byKey);
  }

  const existing = byKey.get(key);

  if (existing) return existing as Promise<T>;

  const loading = load();
  byKey.set(key, loading);

  return loading;
}
