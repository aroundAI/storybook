import 'server-only';

import { z } from 'zod';

import {
  EditEventBatchSchema,
  MAX_EDIT_EVENTS_PER_CALL,
} from '@kit/desktop-integration';
import {
  type EditSessionRefusal,
  closeEditSession,
  openEditSession,
  recordEditEvents,
} from '@kit/desktop-integration/server';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { defineTool } from '../../../registry';
import { requireEpisodeInAccount } from '../read/scope';
import { parseWith } from '../validation';

/**
 * FILM-2002: the StorybookStudio edit session. open_edit_session marks the
 * episode as being edited (status `editing`), record_edit_events appends
 * what happened, close_edit_session rolls the events into a summary and
 * puts the previous status back. FILM-2003's deliver_edit ends a session as
 * delivered instead. The database functions check the caller and move the
 * status in one transaction; these tools add the team scope and the error
 * contract.
 */
type Client = McpPrincipal['supabase'];

const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const sessionId = z
  .string()
  .uuid()
  .describe('The session id open_edit_session returned.');

const REFUSAL_MESSAGES: Record<EditSessionRefusal['code'], string> = {
  NOT_FOUND: 'No edit session or episode with this id in your team.',
  FORBIDDEN: 'You cannot do this to the edit session.',
  VALIDATION_FAILED: 'The edit session refused the request.',
  RUN_IN_PROGRESS: 'Another user is editing this episode in the Studio.',
};

/** A database refusal, in the tools' error contract. */
export function sessionRefusal(
  refusal: EditSessionRefusal,
  message?: string,
): McpToolError {
  const details: Record<string, unknown> = {};

  if (refusal.role) details.role = refusal.role;
  if (refusal.status) details.status = refusal.status;
  if (refusal.reason) details.reason = refusal.reason;
  if (refusal.holder) details.holder = refusal.holder;

  return new McpToolError(
    refusal.code,
    message ?? REFUSAL_MESSAGES[refusal.code],
    Object.keys(details).length > 0 ? { details } : {},
  );
}

/** The session, if it belongs to an episode of the bound team. */
async function requireSessionInAccount(
  client: Client,
  accountId: string,
  id: string,
) {
  const { data, error } = await client
    .from('edit_sessions')
    .select('id, episode_id, status')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the edit session.');
  }

  if (!data) {
    throw new McpToolError(
      'NOT_FOUND',
      'No edit session with this id in your team.',
      { details: { sessionId: id } },
    );
  }

  await requireEpisodeInAccount(client, accountId, data.episode_id, 'id');

  return data;
}

function openRefusalMessage(refusal: EditSessionRefusal) {
  switch (refusal.code) {
    case 'FORBIDDEN':
      return refusal.reason === 'connection'
        ? 'This connection is not yours or has been revoked.'
        : `Editing needs the project role member or above; yours is ${refusal.role ?? 'none'}.`;
    case 'VALIDATION_FAILED':
      return `Nothing to edit: the episode is in ${refusal.status}. Generate its storyboard first.`;
    case 'RUN_IN_PROGRESS': {
      const holder = refusal.holder;

      return holder
        ? `${holder.name ?? 'Another user'} has been editing this episode in the Studio since ${holder.since}.`
        : undefined;
    }
    default:
      return undefined;
  }
}

export const openEditSessionTool = defineTool({
  name: 'open_edit_session',
  title: 'Open edit session',
  description:
    'Marks an episode as being edited in StorybookStudio and returns {sessionId, previousStatus, episodeVersion}. Needs the project role member or above. The episode must be in storyboard, generating, ready or published (draft and story are VALIDATION_FAILED: nothing to edit); it moves to editing, and close_edit_session puts the previous status back. If another user has a session open the call is RUN_IN_PROGRESS with who and since; if you already have one open, it is returned. Fetch the edit package after opening: the open bumps the episode version.',
  inputSchema: {
    episodeId: z
      .string()
      .uuid()
      .describe('The episode id (from list_episodes).'),
    packageEtag: z
      .string()
      .min(1)
      .max(200)
      .describe(
        'The etag of the edit package the Studio is editing (from get_edit_package), or the one it is about to fetch.',
      ),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireEpisodeInAccount(
      client,
      context.accountId,
      input.episodeId,
      'id',
    );

    const result = await openEditSession(client, {
      episodeId: input.episodeId,
      packageEtag: input.packageEtag,
      connectionId: context.principal.connectionId,
    });

    if (!result.ok) {
      throw sessionRefusal(result, openRefusalMessage(result));
    }

    return {
      text: result.existing
        ? `Your edit session ${result.session.id} is already open on this episode (it was ${result.previousStatus}).`
        : `Opened edit session ${result.session.id}; the episode is now editing (it was ${result.previousStatus}).`,
      structuredContent: {
        sessionId: result.session.id,
        previousStatus: result.previousStatus,
        existing: result.existing,
        episodeVersion: result.episodeVersion,
        startedAt: result.session.started_at,
      },
    };
  },
});

export const recordEditEventsTool = defineTool({
  name: 'record_edit_events',
  title: 'Record edit events',
  description: `Appends up to ${MAX_EDIT_EVENTS_PER_CALL} events to your open edit session. Each event is {clientEventId, ts (ISO 8601), type, data}; type is plan_proposed {planId, by: ai|user, steps, intent?, scope?}, plan_approved {planId, versionId?}, plan_rejected {planId, reason?}, version_created {versionId, durationSeconds, aiOps, userOps, name?}, qa_run {pass, issues, versionId?, tier?} or delivered {renderIds[], durationSeconds?}; any other field is refused. Re-sending an event with the same clientEventId stores nothing twice. A closed session is VALIDATION_FAILED: open a new one.`,
  inputSchema: {
    sessionId,
    events: z
      .array(z.record(z.unknown()))
      .describe(`The events, at most ${MAX_EDIT_EVENTS_PER_CALL}.`),
  },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: true },
  async handler(input, context) {
    const events = parseWith(EditEventBatchSchema, input.events);
    const client = context.principal.supabase;

    await requireSessionInAccount(client, context.accountId, input.sessionId);

    const result = await recordEditEvents(client, {
      sessionId: input.sessionId,
      events,
    });

    if (!result.ok) {
      throw sessionRefusal(
        result,
        result.code === 'VALIDATION_FAILED' && result.status
          ? `The edit session is ${result.status}; open a new one.`
          : undefined,
      );
    }

    return {
      text: `Recorded ${result.accepted} event${result.accepted === 1 ? '' : 's'}${result.duplicates > 0 ? ` (${result.duplicates} already recorded)` : ''}.`,
      structuredContent: {
        sessionId: input.sessionId,
        accepted: result.accepted,
        duplicates: result.duplicates,
      },
    };
  },
});

export const closeEditSessionTool = defineTool({
  name: 'close_edit_session',
  title: 'Close edit session',
  description:
    "Closes your edit session without delivering: the events are rolled into a summary {versions, finalDuration, aiOps, userOps, plansProposed, plansApproved, qaRuns} and the episode's status goes back to what it was before the session opened. Use deliver_edit instead to hand the result to StoryBook. A session already closed or delivered is VALIDATION_FAILED.",
  inputSchema: { sessionId },
  scope: 'studio:write',
  annotations: { ...WRITE, idempotentHint: false },
  async handler(input, context) {
    const client = context.principal.supabase;

    await requireSessionInAccount(client, context.accountId, input.sessionId);

    const result = await closeEditSession(client, {
      sessionId: input.sessionId,
      reason: 'client',
    });

    if (!result.ok) {
      throw sessionRefusal(
        result,
        result.code === 'VALIDATION_FAILED' && result.status
          ? `The edit session is already ${result.status}.`
          : undefined,
      );
    }

    return {
      text: `Closed edit session ${input.sessionId}; the episode is ${result.episodeStatus}.`,
      structuredContent: {
        sessionId: input.sessionId,
        status: result.session.status,
        summary: result.summary,
        restoredStatus: result.restoredStatus,
        episodeStatus: result.episodeStatus,
        episodeVersion: result.episodeVersion,
      },
    };
  },
});
