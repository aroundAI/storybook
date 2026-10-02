/**
 * Duration-based content scaling lives in `@kit/shared/duration-scaling` so
 * `@kit/generation` (which this package depends on) can read the same shot
 * and scene bounds in its checks (FILM-1901). Re-exported here for the
 * package's existing imports.
 */
export * from '@kit/shared/duration-scaling';
