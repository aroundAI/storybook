/**
 * Output of `canon-roles/canon-extraction.json`, as its `schema_for_llm`
 * describes it. The episode_summary stage (FILM-1901) enforces it.
 *
 * Where extractCanonChangesAction tolerated an omission (a missing list, a
 * missing confidence, no summary, no score) the schema defaults the same
 * way, so enforcing it rejects malformed output without refusing output the
 * action accepted.
 */
import { z } from 'zod';

export const ImmutableEventTypeSchema = z.enum([
  'death',
  'world_fact',
  'relationship',
  'timeline',
  'ability_loss',
  'location_destruction',
]);

export const CanonConfidenceSchema = z.enum(['high', 'medium', 'low']);

export const ExtractedImmutableEventSchema = z.object({
  type: ImmutableEventTypeSchema,
  eventKey: z.string(),
  description: z.string(),
  confidence: CanonConfidenceSchema.default('medium'),
});

export const CharacterStateTypeSchema = z.enum([
  'emotional',
  'physical',
  'relationship',
  'knowledge',
  'ability',
  'location',
  'goal',
]);

export const ExtractedCharacterStateChangeSchema = z.object({
  characterName: z.string(),
  stateType: CharacterStateTypeSchema,
  fromState: z.string(),
  toState: z.string(),
  triggerEvent: z.string(),
});

export const ThreadTypeSchema = z.enum([
  'plot',
  'character',
  'mystery',
  'romantic',
  'conflict',
  'thematic',
]);

export const ExtractedThreadUpdateSchema = z.object({
  threadId: z.string().optional(),
  threadName: z.string(),
  threadType: ThreadTypeSchema.optional(),
  action: z.enum(['open', 'progress', 'resolve']),
  description: z.string(),
  promises: z.array(z.string()).optional(),
});

export const ExtractedWorldStateSchema = z.object({
  location: z.string().optional(),
  timePeriod: z.string().optional(),
  atmosphere: z.string().optional(),
  activeConflicts: z.array(z.string()).optional(),
});

export const CanonExtractionSchema = z.object({
  immutableEvents: z.array(ExtractedImmutableEventSchema).default([]),
  characterStateChanges: z
    .array(ExtractedCharacterStateChangeSchema)
    .default([]),
  threadUpdates: z.array(ExtractedThreadUpdateSchema).default([]),
  episodeSummary: z.string().default(''),
  sentimentScore: z.number().default(0.5),
  keyEvents: z.array(z.string()).default([]),
  worldState: ExtractedWorldStateSchema.optional(),
});

/**
 * The `canonFacts` block of the story stage (FILM-1901): the same reply,
 * read more strictly where the story commit writes it as it is, because the
 * block is stored without an extraction step in between. Built from the
 * fields above, so the prompt's shape lives once. It differs from the full
 * schema in exactly these places: no `immutableEvents` (the story commit
 * writes its own from the story's key events); a thread name is not empty;
 * the summary and score are required, the score within 0 to 1 (nothing is
 * defaulted); the lists are optional; a state change carries only the
 * character and the two states; a world state names its location.
 */
export const StoryCanonFactsSchema = CanonExtractionSchema.omit({
  immutableEvents: true,
}).extend({
  threadUpdates: z
    .array(
      ExtractedThreadUpdateSchema.omit({ threadId: true }).extend({
        threadName: z.string().min(1),
      }),
    )
    .default([]),
  episodeSummary: z.string(),
  sentimentScore: z.number().min(0).max(1),
  keyEvents: z.array(z.string()).optional(),
  characterStateChanges: z
    .array(
      ExtractedCharacterStateChangeSchema.pick({
        characterName: true,
        fromState: true,
        toState: true,
      }),
    )
    .optional(),
  worldState: ExtractedWorldStateSchema.required({ location: true }).optional(),
});

export const CanonExtractionOutputSchema = z.object({
  extraction: CanonExtractionSchema,
});

export type CanonExtraction = z.infer<typeof CanonExtractionSchema>;
export type StoryCanonFacts = z.infer<typeof StoryCanonFactsSchema>;
export type CanonExtractionOutput = z.infer<typeof CanonExtractionOutputSchema>;
