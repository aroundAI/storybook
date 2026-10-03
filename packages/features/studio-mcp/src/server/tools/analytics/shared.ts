import 'server-only';

import { type ZodTypeAny, z } from 'zod';

import { ActionRefusal } from '@kit/content-analytics/lib/action-result';
import { PlatformSelectionSchema } from '@kit/content-analytics/lib/schemas/platforms';
import type { AnalyticsClient } from '@kit/content-analytics/server/analytics-client';
import { getCoverageMatrixService } from '@kit/content-analytics/server/coverage-service';
import { assertScopeAccess } from '@kit/content-analytics/server/scope-access';

import { McpToolError } from '../../../errors';
import type { McpToolAnnotations, McpToolContext } from '../../../registry';

/**
 * What every analytics tool shares (FILM-1906): the input vocabulary, the
 * team check, the error mapping and the notes each result carries.
 *
 * The rules, in one place so a tool cannot forget one:
 *
 * - A tool reads only through a `@kit/content-analytics` service, on the
 *   principal's RLS-scoped client. ClickHouse has no row-level security, so
 *   `@kit/clickhouse` is never imported here (lint and a source scan).
 * - A connection is bound to one team. Every id a tool takes is resolved
 *   as the user and must belong to `context.accountId`; another team's id
 *   is FORBIDDEN even when the user is a member there too.
 * - A service's refusal becomes the error contract, never a crash: the
 *   wrappers' `withRefusals` returns an `ActionRefusal` as a value, and a
 *   tool returns it as `isError` with the refusal's own words.
 * - A result carries the coverage note the page shows, and when ClickHouse
 *   is off (production's state) says so with a reason; figures stay null
 *   or empty, never zero.
 */

export const READ_ONLY: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
};

export const CalendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A calendar day, YYYY-MM-DD');

export const dateRangeArgs = {
  from: CalendarDay.optional().describe(
    'First day of the window, YYYY-MM-DD. Default: 30 days before `to`.',
  ),
  to: CalendarDay.optional().describe(
    'Last day of the window, inclusive, YYYY-MM-DD. Default: today.',
  ),
};

export const platformArg = z
  .string()
  .optional()
  .describe(
    'One platform (youtube, tiktok, instagram, twitter). Absent: every platform, as the dashboard shows without its filter.',
  );

export const channelIdArg = z
  .string()
  .uuid()
  .optional()
  .describe('A channel (platform connection) id, from list_channels.');

export const pageArgs = {
  cursor: z
    .string()
    .optional()
    .describe('The `nextCursor` of the previous page.'),
  limit: z.number().int().min(1).max(50).default(25),
};

export interface Window {
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
}

/** The window a tool reads, defaulting as the project dashboard does. */
export function windowOf(
  input: { from?: string; to?: string },
  defaultDays = 30,
): Window {
  const toDate = input.to ? dayStart(input.to) : dayStart(isoDay(new Date()));
  const fromDate = input.from
    ? dayStart(input.from)
    : new Date(toDate.getTime() - defaultDays * 86_400_000);

  if (fromDate > toDate) {
    throw new McpToolError('VALIDATION_FAILED', '`from` is after `to`.', {
      details: { from: isoDay(fromDate), to: isoDay(toDate) },
    });
  }

  return { from: isoDay(fromDate), to: isoDay(toDate), fromDate, toDate };
}

export function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function dayStart(day: string) {
  return new Date(`${day}T00:00:00.000Z`);
}

/** The platform filter as the services take it: a list, or absent. */
export function platformsOf(platform: string | undefined) {
  return platform === undefined
    ? undefined
    : parseWith(PlatformSelectionSchema, [platform]);
}

/**
 * Validates with a service's own schema, so a tool accepts exactly what
 * the page's action accepts. A failure is VALIDATION_FAILED with the
 * issues, as the error contract says.
 */
export function parseWith<Schema extends ZodTypeAny>(
  schema: Schema,
  input: unknown,
): z.output<Schema> {
  const parsed = schema.safeParse(input);

  if (!parsed.success) {
    throw new McpToolError('VALIDATION_FAILED', 'The arguments were refused.', {
      details: {
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }

  return parsed.data;
}

const OTHER_TEAM =
  'That record belongs to another team than this connection is bound to, or does not exist.';

function forbidden(context: McpToolContext, what: string) {
  return new McpToolError('FORBIDDEN', `${what}: ${OTHER_TEAM}`, {
    details: { bound_account: context.accountSlug },
  });
}

/**
 * Proves a project, account or channel scope is the connection's team's,
 * with the same check the page runs (`assertScopeAccess`), and then that
 * the account it resolved to is the one the connection is bound to. The
 * second half is what the page does not need: a user in teams A and B,
 * with a token for A, is a member of B's project and would pass RLS.
 *
 * Returns the scope as the services take it, with `accountId` filled in
 * for an account-level read.
 */
export async function requireTeamScope(
  context: McpToolContext,
  scope: { projectId?: string; channelId?: string },
): Promise<{ projectId?: string; accountId?: string; connectionId?: string }> {
  const serviceScope = scope.projectId
    ? { projectId: scope.projectId, connectionId: scope.channelId }
    : { accountId: context.accountId, connectionId: scope.channelId };

  let resolved: string | undefined;

  try {
    resolved = await assertScopeAccess(
      context.principal.supabase,
      serviceScope,
    );
  } catch {
    throw forbidden(context, scope.channelId ? 'Scope or channel' : 'Scope');
  }

  if (resolved !== undefined && resolved !== context.accountId) {
    throw forbidden(context, 'Project');
  }

  return serviceScope;
}

type Client = AnalyticsClient;

/** The publish's project and account, through RLS; another team's is FORBIDDEN. */
export async function requireOwnedPublish(
  context: McpToolContext,
  publishId: string,
) {
  const { data } = await context.principal.supabase
    .from('publishes')
    .select(
      'id, episode_id, episodes!inner(project_id, projects!inner(account_id))',
    )
    .eq('id', publishId)
    .maybeSingle();

  const episode = data?.episodes as {
    project_id: string;
    projects: { account_id: string };
  } | null;

  if (!data || episode?.projects.account_id !== context.accountId) {
    throw forbidden(context, 'Video');
  }

  return { projectId: episode.project_id, episodeId: data.episode_id };
}

export async function requireOwnedEpisode(
  context: McpToolContext,
  episodeId: string,
) {
  const { data } = await context.principal.supabase
    .from('episodes')
    .select('id, project_id, projects!inner(account_id)')
    .eq('id', episodeId)
    .maybeSingle();

  const project = data?.projects as { account_id: string } | null;

  if (!data || project?.account_id !== context.accountId) {
    throw forbidden(context, 'Episode');
  }

  return { projectId: data.project_id };
}

/**
 * A row keyed by `account_id` (experiments, channel experiments, generated
 * reports) is the team's or FORBIDDEN. Through RLS, so a row the user may
 * not see and a row of another team answer the same way.
 */
export async function requireOwnedRow(
  context: McpToolContext,
  table: 'analytics_experiments' | 'channel_experiments' | 'generated_reports',
  id: string,
  what: string,
) {
  const client = context.principal.supabase as Client;
  const { data } = await client
    .from(table)
    .select('id, account_id')
    .eq('id', id)
    .maybeSingle();

  if (!data || data.account_id !== context.accountId) {
    throw forbidden(context, what);
  }
}

/**
 * Runs a service and maps what it throws onto the error contract.
 *
 * An `ActionRefusal` is a rule the caller ran into, worded for them: it is
 * returned with its own message, under the code its wording implies. The
 * access checks throw a plain `Error` whose message says "not found or
 * access denied" on purpose (scope-access.ts), and that is FORBIDDEN. Any
 * other error is left to the registry, which logs it and answers INTERNAL.
 */
export async function callService<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof McpToolError) throw error;

    if (error instanceof ActionRefusal) {
      throw new McpToolError(codeForRefusal(error.message), error.message, {
        details: { refusal: error.message },
      });
    }

    if (
      error instanceof Error &&
      /access denied|not part of this scope|not accessible/i.test(error.message)
    ) {
      throw new McpToolError('FORBIDDEN', error.message);
    }

    throw error;
  }
}

function codeForRefusal(message: string) {
  if (/not in your|not found|no such/i.test(message)) return 'NOT_FOUND';
  if (
    /cannot|can't|may not|not allowed|another account|not yours/i.test(message)
  ) {
    return 'FORBIDDEN';
  }

  return 'VALIDATION_FAILED';
}

/**
 * The note every analytics result carries (criterion 4): the coverage
 * strip's answer for the same scope and window — connected channels, data
 * in the window, or why a platform cannot have any — and whether ClickHouse
 * was read at all. `measured: false` is production's state
 * (`CLICKHOUSE_ENABLED=false`): every observed cell is null and the figures
 * beside it are unmeasured, not zero.
 */
export interface AnalyticsNotes {
  window: { from: string; to: string };
  measured: boolean;
  reason: string | null;
  coverage: Awaited<ReturnType<typeof getCoverageMatrixService>>;
}

export const NOT_MEASURED_REASON =
  'Not measured: ClickHouse is off (CLICKHOUSE_ENABLED=false, production’s state), so figures are null or empty rather than zero.';

export async function analyticsNotes(
  context: McpToolContext,
  scope: {
    projectId?: string;
    accountId?: string;
    connectionId?: string;
    platforms?: z.output<typeof PlatformSelectionSchema>;
  },
  window: { from: string; to: string },
): Promise<AnalyticsNotes> {
  const coverage = await callService(() =>
    getCoverageMatrixService(context.principal.supabase, {
      scope,
      from: window.from,
      to: window.to,
    }),
  );

  return {
    window,
    measured: coverage.observed,
    reason: coverage.observed ? null : NOT_MEASURED_REASON,
    coverage,
  };
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

/**
 * A page of a list a service returns whole. The cursor is an opaque offset
 * over the service's own stable order; `limit` is at most 50.
 */
export function paginate<T>(
  items: T[],
  page: { cursor?: string; limit: number },
): Page<T> {
  const offset = cursorOffset(page.cursor);
  const next = offset + page.limit;

  return {
    items: items.slice(offset, next),
    nextCursor: next < items.length ? cursorFor(next) : null,
    total: items.length,
  };
}

/** The cursor for the page starting at `offset`. */
export function cursorFor(offset: number) {
  return Buffer.from(JSON.stringify({ offset })).toString('base64url');
}

/** The offset a cursor carries; none is the first page. */
export function cursorOffset(cursor: string | undefined) {
  if (!cursor) return 0;

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { offset?: unknown };

    if (typeof parsed.offset === 'number' && parsed.offset >= 0) {
      return parsed.offset;
    }
  } catch {
    // fall through
  }

  throw new McpToolError(
    'VALIDATION_FAILED',
    'The cursor is not one this tool issued.',
  );
}
