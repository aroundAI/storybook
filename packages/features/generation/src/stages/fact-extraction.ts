/**
 * The `fact_extraction` stage (FILM-1901, part D): one part over an uploaded
 * research document; commit inserts `verified_facts`, as
 * `handlers/fact-extraction.ts` did before it moved here.
 */
import { z } from 'zod';

import factExtractionPrompt from '@kit/prompt-engine/prompts/documentary/fact-extraction.json';
import {
  FACT_EXTRACTION_MAX_FACTS,
  FactCategorySchema,
  type FactExtractionOutput,
  FactExtractionOutputSchema,
} from '@kit/prompt-engine/schemas';
import { sanitizeStrings } from '@kit/shared/prompt-sanitiser';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { registerStage } from '../registry';
import type { CheckError, StageDefinition } from '../types';

export const FactExtractionTargetSchema = z.object({
  projectId: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  /** The uploaded document's text */
  content: z.string(),
  sourceTitle: z.string(),
  sourceCitation: z.string().optional(),
});

export type FactExtractionTarget = z.infer<typeof FactExtractionTargetSchema>;

export interface FactExtractionData {
  extractedCount: number;
  facts: Array<{ claim: string; category: string; confidence: number }>;
}

export interface VerifiedFactRow {
  project_id: string;
  claim: string;
  simplified_claim: string;
  category: string;
  source_type: 'other';
  source_citation: string;
  source_title: string;
  confidence_score: number;
  verification_status: 'unverified';
  created_by: string;
}

/** The stored facts keep the source as given; only the prompt is defused. */
export function buildVerifiedFactRows(
  target: FactExtractionTarget,
  facts: FactExtractionOutput['facts'],
): VerifiedFactRow[] {
  return facts.map((fact) => ({
    project_id: target.projectId,
    claim: fact.claim,
    simplified_claim: fact.claim.slice(0, 100),
    category: fact.category,
    source_type: 'other',
    source_citation: target.sourceCitation ?? target.sourceTitle,
    source_title: target.sourceTitle,
    confidence_score: fact.confidence,
    verification_status: 'unverified',
    created_by: target.userId,
  }));
}

export const factExtractionStage: StageDefinition<
  FactExtractionTarget,
  FactExtractionOutput,
  FactExtractionData
> = {
  key: 'fact_extraction',
  targetType: 'project',
  targetSchema: FactExtractionTargetSchema,
  outputSchema: FactExtractionOutputSchema,

  async parts() {
    return [singlePart('facts', 'Verifiable claims in the source')];
  },

  async prepare(_ctx, target, part) {
    return buildBrief({
      stage: 'fact_extraction',
      part,
      prompt: factExtractionPrompt as PromptFile,
      // An uploaded document: the least trusted text in the product (KB-101)
      variables: sanitizeStrings({
        content: target.content,
        source_title: target.sourceTitle,
        source_citation: target.sourceCitation ?? target.sourceTitle,
      }),
      context: {
        project: { id: target.projectId },
        source: {
          title: target.sourceTitle,
          citation: target.sourceCitation ?? target.sourceTitle,
          characters: target.content.length,
        },
      },
      outputSchema: FactExtractionOutputSchema,
      constraints: {
        maxFacts: FACT_EXTRACTION_MAX_FACTS,
        categories: FactCategorySchema.options,
        confidence: 'from 0 to 1',
        claim: 'a self-contained, objectively verifiable statement',
      },
      targetVersion: null,
    });
  },

  async check(_ctx, _target, out) {
    const errors: CheckError[] = [];

    out.facts.forEach((fact, index) => {
      if (!fact.claim.trim()) {
        errors.push({
          path: `facts.${index}.claim`,
          code: 'empty_claim',
          message: 'A fact needs a claim',
        });
      }
    });

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const facts = outputs.flatMap((out) => out.facts);
    const data: FactExtractionData = {
      extractedCount: facts.length,
      facts: facts.map((fact) => ({
        claim: fact.claim,
        category: fact.category,
        confidence: fact.confidence,
      })),
    };

    if (facts.length === 0) {
      return { status: 'skipped', reason: 'no facts extracted', data };
    }

    const rows = buildVerifiedFactRows(target, facts);
    const stamped = ctx.originColumnsAvailable
      ? rows.map(
          (row) => ({ ...row, generation_origin: run.origin }) as VerifiedFactRow,
        )
      : rows;

    const { error } = await ctx.client.from('verified_facts').insert(stamped);

    if (error) {
      throw new Error(`Failed to insert facts: ${error.message}`);
    }

    return { status: 'committed', data };
  },
};

registerStage(factExtractionStage);
