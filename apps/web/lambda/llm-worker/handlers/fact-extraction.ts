/**
 * Fact Extraction Handler
 *
 * Extracts verifiable factual claims from source material using LLM,
 * then persists each extracted fact into the verified_facts table.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

interface FactExtractionPayload {
  content: string;
  projectId: string;
  sourceTitle: string;
  sourceCitation?: string;
  userId: string;
}

interface ExtractedFact {
  claim: string;
  category: string;
  confidence: number;
  source_context: string;
}

interface FactExtractionLLMOutput {
  facts: ExtractedFact[];
}

interface FactExtractionResult {
  success: boolean;
  data: {
    extractedCount: number;
    facts: Array<{
      claim: string;
      category: string;
      confidence: number;
    }>;
  };
}

export async function processFactExtraction(
  payload: Record<string, unknown>,
  supabase: SupabaseClient,
): Promise<FactExtractionResult> {
  const data = payload as FactExtractionPayload;

  console.log(
    `[Fact Extraction] Starting extraction for project ${data.projectId}`,
  );

  const { executeLLM } = await import('@kit/prompt-engine/server');

  const result = await executeLLM<FactExtractionLLMOutput>({
    templateSlug: 'documentary/fact-extraction',
    variables: {
      content: data.content,
      source_title: data.sourceTitle,
      source_citation: data.sourceCitation ?? data.sourceTitle,
    },
    context: {
      name: 'fact-extraction',
      accountId: data.projectId,
      userId: data.userId,
    },
    supabaseClient: supabase,
  });

  const facts = result?.data?.facts;

  if (!facts || facts.length === 0) {
    console.log('[Fact Extraction] No facts extracted.');
    return {
      success: true,
      data: {
        extractedCount: 0,
        facts: [],
      },
    };
  }

  console.log(
    `[Fact Extraction] Extracted ${facts.length} facts, inserting into verified_facts`,
  );

  const rows = facts.map((fact) => ({
    project_id: data.projectId,
    claim: fact.claim,
    simplified_claim: fact.claim.slice(0, 100),
    category: fact.category,
    source_type: 'other' as const,
    source_citation: data.sourceCitation ?? data.sourceTitle,
    source_title: data.sourceTitle,
    confidence_score: fact.confidence,
    verification_status: 'unverified' as const,
    created_by: data.userId,
  }));

  const { error } = await supabase.from('verified_facts').insert(rows);

  if (error) {
    throw new Error(`Failed to insert facts: ${error.message}`);
  }

  console.log(`[Fact Extraction] Successfully inserted ${facts.length} facts`);

  return {
    success: true,
    data: {
      extractedCount: facts.length,
      facts: facts.map((f) => ({
        claim: f.claim,
        category: f.category,
        confidence: f.confidence,
      })),
    },
  };
}
