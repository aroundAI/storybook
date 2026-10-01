import type { Json } from '@kit/supabase/database';

/**
 * A failed publish keeps its existing `publishes.metadata` and adds the
 * failure. `metadata` is jsonb, so it is not guaranteed to be an object (KB-66).
 */
export function mergeFailureMetadata(
  existing: Json | undefined,
  failure: {
    error: unknown;
    errorCode?: unknown;
    errorStack: unknown;
    failedAt: unknown;
  },
): Record<string, unknown> {
  const base =
    existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing
      : {};

  return {
    ...base,
    error: failure.error,
    ...(failure.errorCode !== undefined && { errorCode: failure.errorCode }),
    errorStack: failure.errorStack,
    failedAt: failure.failedAt,
  };
}
