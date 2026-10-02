/**
 * Output of `documentary/fact-extraction.json`, the Zod its
 * `output.schema.definition` spells out. The fact_extraction stage
 * (FILM-1901) enforces it.
 */
import { z } from 'zod';

export const FactCategorySchema = z.enum([
  'historical_event',
  'scientific_finding',
  'statistic',
  'biographical',
  'geographical',
  'technical',
  'cultural',
  'economic',
  'political',
  'other',
]);

export type FactCategory = z.infer<typeof FactCategorySchema>;

export const ExtractedFactSchema = z.object({
  claim: z.string(),
  category: FactCategorySchema,
  confidence: z.number().min(0).max(1),
  source_context: z.string(),
});

export type ExtractedFact = z.infer<typeof ExtractedFactSchema>;

/** The prompt asks for at most 30 facts per source. */
export const FACT_EXTRACTION_MAX_FACTS = 30;

export const FactExtractionOutputSchema = z.object({
  facts: z.array(ExtractedFactSchema).max(FACT_EXTRACTION_MAX_FACTS),
});

export type FactExtractionOutput = z.infer<typeof FactExtractionOutputSchema>;
