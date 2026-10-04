import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

import type { EditEvent } from '../edit-events.schema';
import {
  type EditSessionSummary,
  type StoredEditEvent,
  summarizeEditSession,
} from '../edit-sessions.service';

/**
 * The edit-session service (FILM-2002). Every write is one call to a
 * SECURITY DEFINER function that checks the caller and moves the episode's
 * status in the same transaction; this module computes what the database
 * cannot (the summary) and gives the answers a type. Refusals come back as
 * values, `{ok: false, code}`, never as thrown text; a thrown error is a
 * database failure.
 *
 * The client decides who is acting: a principal's RLS client for the MCP
 * tools, a user's server client for FILM-2006's force-close, the admin
 * client for the hourly stale close.
 */
type Client = SupabaseClient<Database>;

export type EditSessionRow =
  Database['public']['Tables']['edit_sessions']['Row'];

export type EditSessionRefusalCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'VALIDATION_FAILED'
  | 'RUN_IN_PROGRESS';

export interface EditSessionHolder {
  sessionId: string;
  userId: string;
  name: string | null;
  since: string;
}

export type EditSessionRefusal = {
  ok: false;
  code: EditSessionRefusalCode;
  /** The project role, for FORBIDDEN on open. */
  role?: string;
  /** The session or episode status behind a VALIDATION_FAILED. */
  status?: string;
  reason?: string;
  /** Who holds the episode, for RUN_IN_PROGRESS. */
  holder?: EditSessionHolder;
};

export type OpenEditSessionResult =
  | {
      ok: true;
      /** True when the caller already had this session open. */
      existing: boolean;
      session: EditSessionRow;
      previousStatus: string;
      /** episodes.version after the open (the open itself bumps it). */
      episodeVersion: number;
    }
  | EditSessionRefusal;

export type RecordEditEventsResult =
  | { ok: true; accepted: number; duplicates: number }
  | EditSessionRefusal;

export type CloseEditSessionResult =
  | {
      ok: true;
      session: EditSessionRow;
      summary: EditSessionSummary;
      /** The status put back, or null when the episode had already moved on. */
      restoredStatus: string | null;
      episodeStatus: string;
      episodeVersion: number;
    }
  | EditSessionRefusal;

export type CloseReason = 'client' | 'admin' | 'stale';

/** A session idle this long is closed by the hourly cron. */
export const STALE_EDIT_SESSION_HOURS = 24;

function answer<T>(
  data: unknown,
  error: { message: string } | null,
  what: string,
): T {
  if (error) {
    throw new Error(`${what} failed: ${error.message}`);
  }

  return data as T;
}

export async function openEditSession(
  client: Client,
  input: {
    episodeId: string;
    packageEtag: string;
    connectionId?: string | null;
  },
): Promise<OpenEditSessionResult> {
  const { data, error } = await client.rpc('open_edit_session', {
    p_episode_id: input.episodeId,
    p_package_etag: input.packageEtag,
    ...(input.connectionId ? { p_connection_id: input.connectionId } : {}),
  });

  return answer<OpenEditSessionResult>(data, error, 'open_edit_session');
}

export async function recordEditEvents(
  client: Client,
  input: { sessionId: string; events: readonly EditEvent[] },
): Promise<RecordEditEventsResult> {
  const { data, error } = await client.rpc('record_edit_events', {
    p_session_id: input.sessionId,
    p_events: input.events.map((event) => ({
      client_event_id: event.clientEventId,
      ts: event.ts,
      type: event.type,
      data: event.data,
    })),
  });

  return answer<RecordEditEventsResult>(data, error, 'record_edit_events');
}

/** Every event of a session, in time order, paged past the 1000-row cap. */
export async function listEditEvents(
  client: Client,
  sessionId: string,
): Promise<StoredEditEvent[]> {
  return fetchAllRows<StoredEditEvent>(
    (from, to) =>
      client
        .from('edit_events')
        .select('id, ts, type, data')
        .eq('edit_session_id', sessionId)
        .order('id', { ascending: true })
        .range(from, to),
    'edit_events',
  );
}

/**
 * Closes a session: its events rolled into the summary, the episode's
 * status restored when nothing was delivered. `reason` is 'client' for
 * the session's user, 'admin' for a project owner or admin (FILM-2006's
 * force-close), 'stale' for the service role.
 */
export async function closeEditSession(
  client: Client,
  input: { sessionId: string; reason?: CloseReason },
): Promise<CloseEditSessionResult> {
  const { data: session, error: readError } = await client
    .from('edit_sessions')
    .select('id, status')
    .eq('id', input.sessionId)
    .maybeSingle();

  if (readError) {
    throw new Error(`Reading the edit session failed: ${readError.message}`);
  }

  if (!session) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  const summary = summarizeEditSession(
    session.status === 'open' ? await listEditEvents(client, session.id) : [],
  );

  const { data, error } = await client.rpc('close_edit_session', {
    p_session_id: input.sessionId,
    p_summary: summary,
    p_reason: input.reason ?? 'client',
  });

  const result = answer<
    | Omit<Extract<CloseEditSessionResult, { ok: true }>, 'summary'>
    | EditSessionRefusal
  >(data, error, 'close_edit_session');

  return result.ok ? { ...result, summary } : result;
}

/** The episode's open session, if any, as the caller may read it. */
export async function getOpenEditSession(
  client: Client,
  episodeId: string,
): Promise<EditSessionRow | null> {
  const { data, error } = await client
    .from('edit_sessions')
    .select('*')
    .eq('episode_id', episodeId)
    .eq('status', 'open')
    .maybeSingle();

  if (error) {
    throw new Error(`Reading the open edit session failed: ${error.message}`);
  }

  return data;
}

/**
 * The hourly cron's half (FILM-2002 AC6): every open session with no event
 * for {@link STALE_EDIT_SESSION_HOURS} hours is closed as 'stale', which
 * restores the episode's status; the Studio opens a new session next time.
 * Needs the admin client. Bounded per run; the rest wait an hour.
 */
export async function closeStaleEditSessions(
  admin: Client,
  options: { now?: Date; idleHours?: number; limit?: number } = {},
): Promise<{ closed: number; failed: number; ids: string[] }> {
  const now = options.now ?? new Date();
  const idleHours = options.idleHours ?? STALE_EDIT_SESSION_HOURS;
  const cutoff = new Date(now.getTime() - idleHours * 3_600_000).toISOString();

  const { data, error } = await admin
    .from('edit_sessions')
    .select('id')
    .eq('status', 'open')
    .lt('last_event_at', cutoff)
    .order('last_event_at', { ascending: true })
    .limit(options.limit ?? 100);

  if (error) {
    throw new Error(`Listing stale edit sessions failed: ${error.message}`);
  }

  const ids: string[] = [];
  let failed = 0;

  for (const { id } of data ?? []) {
    try {
      const result = await closeEditSession(admin, {
        sessionId: id,
        reason: 'stale',
      });

      if (result.ok) ids.push(id);
      else if (result.code !== 'VALIDATION_FAILED') failed += 1;
    } catch {
      failed += 1;
    }
  }

  return { closed: ids.length, failed, ids };
}
