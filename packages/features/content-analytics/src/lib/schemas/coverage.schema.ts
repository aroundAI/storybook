import { z } from 'zod';

import { ScopeSchema } from './traffic.schema';

/**
 * Input for `getCoverageMatrixAction` (FILM-1704). Out of the action module
 * for the reason `traffic.schema.ts` gives: a `'use server'` file may export
 * only async functions, so a schema with a `.refine` would be untestable
 * there.
 *
 * The window is calendar days, not timestamps. Coverage changes when ingest
 * runs, not when a picker moves by an hour, so a day is the grain the cache
 * is keyed on and the grain the query binds as `Date`.
 */
const CalendarDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, {
  message: 'Expected a calendar day, YYYY-MM-DD',
});

export const CoverageMatrixSchema = z
  .object({
    scope: ScopeSchema,
    from: CalendarDay,
    to: CalendarDay,
  })
  .refine((value) => value.from <= value.to, {
    message: '`from` must not be after `to`.',
    path: ['from'],
  });

export type CoverageMatrixInput = z.infer<typeof CoverageMatrixSchema>;
