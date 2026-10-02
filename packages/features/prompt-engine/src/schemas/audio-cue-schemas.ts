/**
 * Output of `audio-generation/scene-audio-refinement.json`, the Zod its
 * `output.schema.definition` spells out. The audio_cues stage (FILM-1901)
 * enforces it per scene part.
 */
import { z } from 'zod';

export const AudioCueKindSchema = z.enum(['music', 'sfx', 'ambient']);

export type AudioCueKind = z.infer<typeof AudioCueKindSchema>;

export const GeneratedAudioCueSchema = z.object({
  type: AudioCueKindSchema,
  prompt: z.string(),
  startShotSequence: z.number(),
  startOffsetInShot: z.number().default(0),
  durationSeconds: z.number(),
  reasoning: z.string().optional(),
});

export type GeneratedAudioCue = z.infer<typeof GeneratedAudioCueSchema>;

export const AudioCueGenerationOutputSchema = z.object({
  cues: z.array(GeneratedAudioCueSchema),
});

export type AudioCueGenerationOutput = z.infer<
  typeof AudioCueGenerationOutputSchema
>;
