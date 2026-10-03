import 'server-only';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import { OffsetCursor, decodeCursor, encodeCursor } from '../pagination';
import { requireEpisodeInAccount } from '../read/scope';
import { type StoredPart, readParts } from './parts-store';

type Client = McpPrincipal['supabase'];

const RUN_COLUMNS =
  'id, stage, mode, status, target_type, target_id, origin, error, parent_run_id, created_by, created_at, finalized_at, lease_expires_at';

interface RunRow {
  id: string;
  stage: string;
  mode: string;
  status: string;
  target_type: string;
  target_id: string;
  origin: unknown;
  error: unknown;
  parent_run_id: string | null;
  created_by: string;
  created_at: string;
  finalized_at: string | null;
  lease_expires_at: string | null;
}

function partHistory(part: StoredPart) {
  return {
    partKey: part.partKey,
    status: part.validation.status ?? 'rejected',
    submittedAt: part.submittedAt,
    model: part.validation.model ?? null,
    validationFailures: part.validation.failures,
  };
}

function runHistory(row: RunRow, parts: StoredPart[]) {
  return {
    runId: row.id,
    stage: row.stage,
    mode: row.mode,
    status: row.status,
    targetType: row.target_type,
    targetId: row.target_id,
    origin: row.origin,
    error: row.error,
    parentRunId: row.parent_run_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
    leaseExpiresAt: row.lease_expires_at,
    parts: parts.map(partHistory),
  };
}

/**
 * FR-31: an episode's generation runs, newest first, in either mode, each
 * with its origin, the parts an agent submitted and every validation
 * failure on them, and the runs it chained (an asset description after a
 * story). A run's own `error` holds a failure at finalize or in the worker.
 */
export async function generationHistory(
  client: Client,
  accountId: string,
  input: { episodeId: string; limit: number; cursor?: string },
) {
  await requireEpisodeInAccount(client, accountId, input.episodeId, 'id');

  const offset = decodeCursor(input.cursor, OffsetCursor)?.offset ?? 0;

  const { data, error } = await client
    .from('generation_runs')
    .select(RUN_COLUMNS)
    .eq('account_id', accountId)
    .in('target_type', ['episode', 'scene'])
    .eq('target_id', input.episodeId)
    .order('created_at', { ascending: false })
    .order('id')
    .range(offset, offset + input.limit);

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the generation runs.');
  }

  const rows = (data ?? []) as RunRow[];
  const page = rows.slice(0, input.limit);
  const hasMore = rows.length > input.limit;

  const runIds = page.map((row) => row.id);

  // Chained runs (story -> asset_description) target something else, so
  // they are found by their parent; at most a few per run
  const { data: childData, error: childError } =
    runIds.length > 0
      ? await client
          .from('generation_runs')
          .select(RUN_COLUMNS)
          .in('parent_run_id', runIds)
          .order('created_at')
          .order('id')
      : { data: [], error: null };

  if (childError) {
    throw new McpToolError('INTERNAL', 'Could not read the chained runs.');
  }

  const children = (childData ?? []) as RunRow[];
  const parts = await readParts(client, [
    ...runIds,
    ...children.map((child) => child.id),
  ]);

  return {
    episodeId: input.episodeId,
    runs: page.map((row) => ({
      ...runHistory(row, parts.get(row.id) ?? []),
      children: children
        .filter((child) => child.parent_run_id === row.id)
        .map((child) => runHistory(child, parts.get(child.id) ?? [])),
    })),
    nextCursor: hasMore ? encodeCursor({ offset: offset + input.limit }) : null,
  };
}
