/**
 * Fact Extraction Handler
 *
 * Extracts discrete, verifiable factual claims from content using LLM.
 * WRITES TO DATABASE:
 * - Inserts rows into verified_facts table
 * - Updates fact_extraction_jobs progress (when jobId provided)
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { executeLLMForLambda } from '../llm-utils';

interface FactData {
  claim: string;
  simplified_claim: string;
  category: string;
  confidence_score: number;
  source_citation: string;
}

interface FactExtractionPayload {
  content: string;
  projectId: string;
  sourceTitle: string;
  sourceCitation: string;
  userId: string;
  jobId?: string;
}

export async function processFactExtraction(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<{ success: boolean; extractedCount: number }> {
  const data = payload as FactExtractionPayload;

  console.log(
    `[Fact Extraction] Processing for project ${data.projectId}, source: ${data.sourceTitle}`,
  );

  const { data: facts } = await executeLLMForLambda<FactData[]>({
    templateSlug: 'fact-extraction',
    variables: {
      content: data.content,
      source_title: data.sourceTitle,
      source_citation: data.sourceCitation,
    },
  });

  const filteredFacts = facts.filter((f) => f.confidence_score >= 0.3);

  console.log(
    `[Fact Extraction] Extracted ${facts.length} facts, ${filteredFacts.length} above confidence threshold`,
  );

  if (filteredFacts.length > 0) {
    const rows = filteredFacts.map((f) => ({
      project_id: data.projectId,
      claim: f.claim,
      simplified_claim: f.simplified_claim,
      category: f.category,
      source_type: 'other' as const,
      source_citation: f.source_citation,
      verification_status: 'unverified' as const,
      confidence_score: f.confidence_score,
      created_by: data.userId,
    }));

    const { error: insertError } = await supabase
      .from('verified_facts')
      .insert(rows);

    if (insertError) {
      throw new Error(`Failed to insert facts: ${insertError.message}`);
    }
  }

  if (data.jobId) {
    // Update job progress: increment chunks_completed and set facts count
    // Use raw SQL for atomic increment
    const { error: jobError } = await supabase.rpc('exec_sql', {
      query: `
        UPDATE fact_extraction_jobs 
        SET chunks_completed = chunks_completed + 1,
            facts_extracted = facts_extracted + ${filteredFacts.length},
            status = CASE 
              WHEN chunks_completed + 1 >= chunk_count THEN 'completed'
              ELSE 'processing'
            END,
            updated_at = now()
        WHERE id = '${data.jobId}'
      `,
    });

    if (jobError) {
      // Fallback: simple update without increment
      console.warn(
        '[Fact Extraction] RPC failed, using simple update:',
        jobError.message,
      );

      await supabase
        .from('fact_extraction_jobs')
        .update({
          status: 'completed',
          facts_extracted: filteredFacts.length,
        })
        .eq('id', data.jobId);
    }
  }

  console.log(
    `[Fact Extraction] Complete. Inserted ${filteredFacts.length} facts.`,
  );

  return { success: true, extractedCount: filteredFacts.length };
}
