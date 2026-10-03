/**
 * Output of `quality-evaluation/reel-scout.json`, as its `output.schema`
 * declares it. The shots stage (FILM-1901) enforces it on the reel-scout
 * part in both modes.
 */
import { z } from 'zod';

export const ReelHookTypeSchema = z.enum([
  'question',
  'reveal',
  'conflict',
  'visual',
  'humor',
  'cliffhanger',
  'character',
  'action',
  'reaction',
  'punchline',
]);

export type ReelHookType = z.infer<typeof ReelHookTypeSchema>;

export const ReelSceneAnalysisSchema = z.object({
  sceneNumber: z.number(),
  isReelCandidate: z.boolean(),
  viralScore: z.number().min(1).max(10),
  hookType: ReelHookTypeSchema.nullish(),
  estimatedDurationSeconds: z.number().optional(),
  keyMoment: z.string().nullish(),
  sceneEmotionalArc: z.string(),
  whyThisWorksAsReel: z.string().nullish(),
  whyItDoesntWork: z.string().nullish(),
  improvementSuggestion: z.string().nullish(),
});

export type ReelSceneAnalysis = z.infer<typeof ReelSceneAnalysisSchema>;

export const ReelScoutOutputSchema = z.object({
  sceneAnalyses: z.array(ReelSceneAnalysisSchema),
  topReelCandidates: z.array(z.number()),
  orchestratorNote: z.string(),
});

export type ReelScoutOutput = z.infer<typeof ReelScoutOutputSchema>;

/**
 * The `reel_note` scene-shot-generation places after a scene's content
 * (KB-178): the Reel Scout's priority for a scene it listed in
 * `topReelCandidates`, and '' for any other. The Shot Director and the
 * shots stage both send this, so the two modes steer the model alike.
 */
export function reelNoteFor(
  sceneNumber: number,
  topReelCandidates: readonly number[],
): string {
  return topReelCandidates.includes(sceneNumber)
    ? 'PRIORITY: This scene is a Reel candidate. Lead with a high-impact visual hook in Shot 1. Use close-ups for emotional beats. Make the first 3 seconds grabby.'
    : '';
}
