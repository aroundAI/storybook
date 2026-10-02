/**
 * Fact Extraction Handler
 *
 * The `fact_extraction` stage of `@kit/generation` (FILM-1901): prepare →
 * the `documentary/fact-extraction` prompt → outputSchema and check →
 * commit, which inserts each extracted fact into `verified_facts`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type Ctx,
  type FactExtractionData,
  factExtractionStage,
  runStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

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

  const ctx: Ctx = {
    client: supabase,
    accountId: data.accountId,
    userId: data.userId,
  };

  const { commit } = await runStage(factExtractionStage, ctx, data, {
    generate: async (brief) => {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<unknown>({
        templateSlug: 'documentary/fact-extraction',
        variables: brief.prompt.variables,
        context: {
          name: 'fact-extraction',
          accountId: data.accountId,
          userId: data.userId,
        },
      });

      return {
        output: result.data,
        usage: {
          provider: String(result.metadata.provider),
          model: result.metadata.model,
          tokens: result.metadata.tokens,
          latencyMs: result.metadata.latency,
        },
      };
    },
  });

  console.log(
    commit.status === 'committed'
      ? `[Fact Extraction] Successfully inserted ${commit.data.extractedCount} facts`
      : '[Fact Extraction] No facts extracted.',
  );

  return { success: true, data: commit.data };
}
