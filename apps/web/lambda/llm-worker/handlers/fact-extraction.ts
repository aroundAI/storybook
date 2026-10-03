/**
 * Fact Extraction Handler
 *
 * The `fact_extraction` stage of `@kit/generation` (FILM-1901): prepare →
 * the `documentary/fact-extraction` prompt → outputSchema and check →
 * commit, which inserts each extracted fact into `verified_facts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type FactExtractionData,
  factExtractionStage,
  runStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface FactExtractionResult {
  success: boolean;
  data: FactExtractionData;
}

export async function processFactExtraction(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<FactExtractionResult> {
  const data = parseLlmJobPayload('fact-extraction', payload);

  console.log(
    `[Fact Extraction] Starting extraction for project ${data.projectId}`,
  );

  const ctx = workerCtx(supabase, data);

  // The run writes the brief (FILM-1902): the one model door
  const { commit } = await runStage(
    factExtractionStage,
    ctx,
    data,
    stageRunDeps(),
  );

  console.log(
    commit.status === 'committed'
      ? `[Fact Extraction] Successfully inserted ${commit.data.extractedCount} facts`
      : '[Fact Extraction] No facts extracted.',
  );

  return { success: true, data: commit.data };
}
