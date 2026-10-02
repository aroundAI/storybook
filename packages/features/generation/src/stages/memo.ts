import type { Ctx } from '../types';

/**
 * One load per (ctx, key) for the life of a Ctx. A multi-part stage's
 * parts(), prepare() for each part and commit() all need the same rows
 * (the episode's screenplay, the shot list), and the runner calls them in
 * turn with one Ctx; without this each call would re-read them. A Ctx lives
 * for one worker job or one MCP request, so nothing here outlives a run.
 */
export function memoPerCtx<T>(
  cache: WeakMap<Ctx, Map<string, Promise<T>>>,
  ctx: Ctx,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let byKey = cache.get(ctx);

  if (!byKey) {
    byKey = new Map();
    cache.set(ctx, byKey);
  }

  const hit = byKey.get(key);

  if (hit) return hit;

  const loading = load();
  byKey.set(key, loading);
  loading.catch(() => byKey?.delete(key));

  return loading;
}

/** Case-insensitive, whitespace-tolerant name matching for referential checks. */
export function nameMatches(reference: string, known: string[]): boolean {
  const wanted = reference.trim().toLowerCase();

  if (!wanted) return false;

  return known.some((name) => {
    const candidate = name.trim().toLowerCase();

    return (
      candidate === wanted ||
      candidate.includes(wanted) ||
      wanted.includes(candidate)
    );
  });
}

export function logTo(ctx: Ctx) {
  return ctx.log ?? ((message: string) => console.log(message));
}
