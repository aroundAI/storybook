import 'server-only';

import { z } from 'zod';

import type { CheckError } from '@kit/generation';
import type { Json } from '@kit/supabase/database';

import { McpToolError } from '../../../errors';
import type { McpPrincipal } from '../../../principal';
import {
  type PartValidation,
  PartValidationSchema,
  type SubmitGenerationResult,
} from './schemas';

type Client = McpPrincipal['supabase'];

/**
 * `generation_run_parts`, as the tools see it: read under RLS (members of
 * the run's account), written only through `submit_generation_run_part`
 * (migration 20261003121205), which checks the caller drives an open
 * external run they opened.
 */
export interface StoredPart {
  partKey: string;
  output: unknown;
  validation: PartValidation;
  submittedAt: string;
}

const PartRowSchema = z.object({
  part_key: z.string(),
  output: z.unknown(),
  validation: z.unknown(),
  submitted_at: z.string(),
});

function toStoredPart(row: z.infer<typeof PartRowSchema>): StoredPart {
  const validation = PartValidationSchema.safeParse(row.validation ?? {});

  return {
    partKey: row.part_key,
    output: row.output,
    validation: validation.success ? validation.data : { failures: [] },
    submittedAt: row.submitted_at,
  };
}

export async function readParts(
  client: Client,
  runIds: string[],
): Promise<Map<string, StoredPart[]>> {
  const byRun = new Map<string, StoredPart[]>();

  if (runIds.length === 0) return byRun;

  // A run has a handful of parts (one per scene at most) and a history page
  // at most 50 runs, so this stays far below the 1000-row cap
  const { data, error } = await client
    .from('generation_run_parts')
    .select('run_id, part_key, output, validation, submitted_at')
    .in('run_id', runIds)
    .order('run_id')
    .order('part_key');

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the submitted parts.');
  }

  for (const row of data ?? []) {
    const parts = byRun.get(row.run_id) ?? [];
    parts.push(toStoredPart(PartRowSchema.parse(row)));
    byRun.set(row.run_id, parts);
  }

  return byRun;
}

export async function readPart(
  client: Client,
  runId: string,
  partKey: string,
): Promise<StoredPart | null> {
  const { data, error } = await client
    .from('generation_run_parts')
    .select('part_key, output, validation, submitted_at')
    .eq('run_id', runId)
    .eq('part_key', partKey)
    .maybeSingle();

  if (error) {
    throw new McpToolError('INTERNAL', 'Could not read the submitted part.');
  }

  return data ? toStoredPart(PartRowSchema.parse(data)) : null;
}

/** The parts finalize commits: the accepted ones, by key. */
export function acceptedParts(parts: StoredPart[]) {
  return parts.filter((part) => part.validation.status === 'accepted');
}

export type SubmitOutcome =
  | { ok: true }
  | { ok: false; code: 'RUN_NOT_OPEN' | 'RUN_NOT_FOUND'; status?: string };

const SubmitResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }).passthrough(),
  z.object({
    ok: z.literal(false),
    code: z.enum(['RUN_NOT_OPEN', 'RUN_NOT_FOUND']),
    run: z.object({ status: z.string() }).passthrough().optional(),
  }),
]);

interface SubmitRpcArgs {
  p_run_id: string;
  p_part_key: string;
  p_output: Json;
  p_validation: Json;
  p_accepted: boolean;
  p_model?: string;
}

async function callSubmit(
  client: Client,
  args: SubmitRpcArgs,
): Promise<SubmitOutcome> {
  const { data, error } = await client.rpc('submit_generation_run_part', args);

  if (error) {
    if (error.code === '42501') {
      throw new McpToolError(
        'FORBIDDEN',
        'Only the user who opened this run, with write access to its project, can submit to it.',
      );
    }

    throw new McpToolError('INTERNAL', 'Could not store the part.');
  }

  const parsed = SubmitResponseSchema.parse(data);

  if (parsed.ok) return { ok: true };

  return { ok: false, code: parsed.code, status: parsed.run?.status };
}

export function storeAcceptedPart(
  client: Client,
  input: {
    runId: string;
    partKey: string;
    output: unknown;
    hash: string;
    model?: string;
    result: SubmitGenerationResult;
  },
) {
  return callSubmit(client, {
    p_run_id: input.runId,
    p_part_key: input.partKey,
    p_output: input.output as Json,
    p_validation: {
      hash: input.hash,
      ...(input.model ? { model: input.model } : {}),
      result: input.result,
    } as Json,
    p_accepted: true,
    ...(input.model ? { p_model: input.model } : {}),
  });
}

export function storeRejectedPart(
  client: Client,
  input: {
    runId: string;
    partKey: string;
    output: unknown;
    hash: string;
    errors: CheckError[];
  },
) {
  return callSubmit(client, {
    p_run_id: input.runId,
    p_part_key: input.partKey,
    // A missing output is still a rejection worth recording
    p_output: (input.output ?? {}) as Json,
    p_validation: { hash: input.hash, errors: input.errors } as Json,
    p_accepted: false,
  });
}
