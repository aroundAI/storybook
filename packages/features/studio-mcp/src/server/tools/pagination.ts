import { type ZodType, z } from 'zod';

import { McpToolError } from '../../errors';

/**
 * Paging shared by every list and long-content tool (FILM-1905): `limit`
 * capped at 50 and an opaque `cursor`, so a client pages instead of
 * over-fetching. Each tool's description carries PAGING_NOTE verbatim.
 */
export const PAGE_LIMIT_MAX = 50;
export const PAGE_LIMIT_DEFAULT = 20;

export const PAGING_NOTE = `Paged: pass limit (1-${PAGE_LIMIT_MAX}, default ${PAGE_LIMIT_DEFAULT}) and the cursor from the previous page's nextCursor; nextCursor is null on the last page.`;

export const limitArg = z
  .number()
  .int()
  .min(1)
  .max(PAGE_LIMIT_MAX)
  .default(PAGE_LIMIT_DEFAULT)
  .describe(`Page size, 1 to ${PAGE_LIMIT_MAX}.`);

export const cursorArg = z
  .string()
  .min(1)
  .optional()
  .describe(
    "Opaque cursor from the previous page's nextCursor; omit for the first page.",
  );

export const OffsetCursor = z.object({ offset: z.number().int().min(0) });
export const AfterCursor = z.object({ after: z.number().int() });

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T>(
  cursor: string | undefined,
  schema: ZodType<T>,
): T | undefined {
  if (cursor === undefined) return undefined;

  let parsed: unknown;

  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }

  const result = schema.safeParse(parsed);

  if (!result.success) throw invalidCursor();

  return result.data;
}

function invalidCursor() {
  return new McpToolError(
    'VALIDATION_FAILED',
    'The cursor is not one this tool issued. Start again without a cursor.',
    { details: { errors: [{ path: ['cursor'], message: 'invalid cursor' }] } },
  );
}

/** Splits a list fetched with one extra item into the page and a has-more flag. */
export function pageOf<T>(items: T[], limit: number) {
  return { items: items.slice(0, limit), hasMore: items.length > limit };
}

/**
 * The window of scene numbers after `after`, `limit` scenes wide, plus the
 * cursor for the next window. Scenes are the unit for screenplay, shots and
 * dialogue, so one page is always whole scenes.
 */
export function sceneWindow(
  sceneNumbers: number[],
  after: number | undefined,
  limit: number,
) {
  const ordered = Array.from(new Set(sceneNumbers)).sort((a, b) => a - b);
  const remaining =
    after === undefined ? ordered : ordered.filter((n) => n > after);
  const { items, hasMore } = pageOf(remaining, limit);
  const last = items[items.length - 1];

  return {
    scenes: items,
    totalScenes: ordered.length,
    nextCursor:
      hasMore && last !== undefined ? encodeCursor({ after: last }) : null,
  };
}
