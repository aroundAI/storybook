import { z } from 'zod';

import { TRAFFIC_SOURCE_BUCKETS } from '@kit/clickhouse';

import { PlatformSelectionSchema } from './platforms.schema';

/**
 * Schemas for the deep-dive analytics actions.
 *
 * These live here, outside `server/deep-dive-actions.ts`, because that file
 * is `'use server'`: Next turns every one of its *exports* into a Server
 * Action reference and rejects any that is not an async function. A zod
 * schema carrying a synchronous `.refine` callback therefore cannot be
 * exported from it — which left these rules unreachable from a test, and
 * three of FILM-1605's acceptance criteria resting on nothing verifiable.
 *
 * Importing *into* a `'use server'` file is unaffected by that rule;
 * `revenue.schema.ts` has done exactly this since FILM-1508.
 *
 * Like its siblings, this module depends only on `zod` and a pure export —
 * `TRAFFIC_SOURCE_BUCKETS` comes from `@kit/clickhouse`'s client-safe root,
 * not `/server`, so the ClickHouse driver stays out of any bundle that
 * reaches for these schemas through `zodResolver`.
 */

/**
 * Scope shared by the deep-dive actions: project- or account-level, with
 * optional segment filters.
 */
export const ScopeSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    connectionId: z.string().uuid().optional(),
    /**
     * The page's platform filter (FILM-1709). A list, as the filter is a
     * multi-select; absent is every platform.
     */
    platforms: PlatformSelectionSchema.optional(),
    contentType: z.string().max(50).optional(),
    language: z.string().max(10).optional(),
  })
  .refine((scope) => scope.projectId || scope.accountId, {
    message: 'projectId or accountId is required',
  });

export type Scope = z.infer<typeof ScopeSchema>;

/**
 * Longest window each granularity will serve, so every bucket count lands
 * around 120-180 rather than "however long the channel has existed".
 *
 * Capping only `day` was not a bound: a week or month call with no dates
 * returns every bucket in history, and the breakdown emits a row per
 * (bucket, source) — so a ten-year channel is ~520 buckets of eight group
 * objects through a server action.
 */
export const MAX_BREAKDOWN_SPAN_DAYS = {
  day: 180,
  week: 1_120, // ~160 buckets
  month: 3_650, // ~120 buckets
} as const;

export const TrafficBreakdownSchema = z
  .object({
    scope: ScopeSchema,
    // From @kit/clickhouse, not re-listed: a hand-written copy keeps
    // accepting a granularity after it is removed there, and the lookup's
    // fallback then serves weeks under the old label.
    bucket: z.enum(TRAFFIC_SOURCE_BUCKETS).default('week'),
    // Required, not optional: absent dates mean all history, which is the
    // unbounded case this schema exists to prevent.
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((value) => value.from <= value.to, {
    message: '`from` must not be after `to`.',
    path: ['from'],
  })
  // Every granularity, not just day. `from`/`to` are required above, so
  // this is a real bound rather than a rule the caller opts into.
  .refine(
    (value) =>
      value.to.getTime() - value.from.getTime() <=
      MAX_BREAKDOWN_SPAN_DAYS[value.bucket] * 86_400_000,
    (value) => ({
      message: `A ${value.bucket} breakdown spans at most ${MAX_BREAKDOWN_SPAN_DAYS[value.bucket]} days.`,
      path: ['bucket'],
    }),
  );
