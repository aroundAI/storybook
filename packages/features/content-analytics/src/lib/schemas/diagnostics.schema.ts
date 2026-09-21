import { z } from 'zod';

import { ScopeSchema } from './traffic.schema';

/**
 * Out of the action module because that one is `'use server'`: every export
 * of such a module must be an async function, so a schema cannot live there
 * and stay testable. Same reason as traffic.schema.ts.
 */

/**
 * How many videos one diagnostics call will fetch retention curves for.
 *
 * The same ceiling the scheduled report uses, and for the same reason: the
 * curve rows grow with the video count even now that the query is batched,
 * so the cap is part of the design rather than a tuning detail.
 */
export const MAX_DIAGNOSTIC_VIDEOS = 200;

export const WeeklyDiagnosticsSchema = z.object({
  scope: ScopeSchema,
  /** How far back "recently published" reaches. */
  sinceDays: z.number().int().min(1).max(90).default(7),
  limit: z.number().int().min(1).max(MAX_DIAGNOSTIC_VIDEOS).default(50),
});

export type WeeklyDiagnosticsInput = z.input<typeof WeeklyDiagnosticsSchema>;

/**
 * A bare publish id from the client — the only action in this package that
 * takes one. See the ownership check in `diagnostics-actions.ts`: the uuid
 * shape is all this schema can prove, and proving the *caller* may see it is
 * the action's job.
 */
export const RetentionCurveSchema = z.object({
  publishId: z.string().uuid(),
});

export const EpisodeAnalyticsSchema = z.object({
  episodeId: z.string().uuid(),
});
