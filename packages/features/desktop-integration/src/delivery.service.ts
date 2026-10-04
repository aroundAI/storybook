import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import type { DeliveryPackage } from './delivery-package.schema';
import {
  type EditSessionSummary,
  type StoredEditEvent,
  summarizeEditSession,
} from './edit-sessions.service';
import type { ExplainWhyReport } from './explain-why-report.schema';
import { listEditEvents } from './server/edit-sessions';
import { currentEditPackageEtag } from './server/load-edit-package';

/**
 * deliverEdit (FILM-2003): the one-transaction delivery. The transaction is
 * `public.deliver_edit` (SECURITY DEFINER, run as the caller); this module
 * computes the session summary it stores and types its answer.
 */

/**
 * A delivered session's summary. The report describes the delivered cut, so
 * its versions, duration and operation counts are the record; the plan and
 * QA counts come from the session's events, which the report does not hold.
 */
export function buildDeliverySummary(
  events: readonly StoredEditEvent[],
  report: ExplainWhyReport,
): EditSessionSummary {
  return {
    ...summarizeEditSession(events),
    versions: report.versions.length,
    finalDuration: report.finalDuration,
    aiOps: report.aiOps,
    userOps: report.userOps,
  };
}

export type DeliverEditRefusal =
  | { ok: false; code: 'NOT_FOUND' }
  | {
      ok: false;
      code: 'FORBIDDEN';
      role?: string;
      reason?: 'session' | 'published';
    }
  | {
      ok: false;
      code: 'VALIDATION_FAILED';
      reason: 'session' | 'renders' | 'primary' | 'report' | 'not_ready';
      status?: string;
      primaries?: number;
      renders?: Array<{ renderId: string; status: string }>;
    }
  | {
      ok: false;
      code: 'TARGET_CHANGED';
      currentVersion: number;
      expectedVersion: number;
      /** get_edit_package's etag now; null when the caller cannot see the episode. */
      etag: string | null;
    };

export interface DeliverEditSuccess {
  ok: true;
  episodeId: string;
  episodeStatus: 'ready';
  episodeVersion: number;
  finalVideoUrl: string;
  masterVideoAssetId: string;
  primaryRenderId: string;
  renderIds: string[];
  superseded: number;
  sessionId: string;
}

export type DeliverEditResult = DeliverEditSuccess | DeliverEditRefusal;

type Client = SupabaseClient<Database>;

/**
 * Delivers a validated package as the client's user. Throws only when the
 * database cannot be asked; a refusal is a value.
 */
export async function deliverEdit(
  client: Client,
  delivery: DeliveryPackage,
  /** The team and episode the session belongs to, for the TARGET_CHANGED etag. */
  scope: { accountId: string; episodeId: string },
): Promise<DeliverEditResult> {
  const events = await listEditEvents(client, delivery.sessionId);
  const summary = buildDeliverySummary(events, delivery.report);

  const { data, error } = await client.rpc('deliver_edit', {
    p_session_id: delivery.sessionId,
    p_episode_version: delivery.episodeVersion,
    p_renders: delivery.renders.map((render) => ({
      renderId: render.renderId,
      primary: render.primary === true,
    })),
    p_report: delivery.report,
    p_qa: delivery.qa,
    p_summary: summary,
  });

  if (error) {
    throw new Error(`deliver_edit failed: ${error.message}`);
  }

  const result = data as unknown as DeliverEditResult;

  // The Studio re-syncs to what get_edit_package serves now: the same etag,
  // from the one function that computes it (FILM-2001).
  if (!result.ok && result.code === 'TARGET_CHANGED') {
    return { ...result, etag: await currentEditPackageEtag(client, scope) };
  }

  return result;
}
