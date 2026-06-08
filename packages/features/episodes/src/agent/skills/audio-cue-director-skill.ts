/**
 * Audio Cue Director Skill
 *
 * Generates coherent audio cues (music, SFX, ambient) from visual shot data
 * using the `scene-audio-refinement` prompt template.
 *
 * Each cue references shots by sequence number and includes timing offsets,
 * enabling precise placement on the audio timeline.
 *
 * Used by the Audio Cue Orchestrator after shots have been generated:
 *   1. Audio Cue Director generates cues from shot data
 *   2. Audio Cue Evaluator validates timeline coverage and overlaps
 *   3. If evaluation fails, the orchestrator requests targeted revision
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolError, toolSuccess } from '@kit/agent';

interface GeneratedAudioCue {
  type: 'music' | 'sfx' | 'ambient';
  prompt: string;
  startShotSequence: number;
  startOffsetInShot: number;
  durationSeconds: number;
  reasoning?: string;
}

interface AudioCueResult {
  cues: GeneratedAudioCue[];
}

const generateAudioCuesTool = createTool({
  name: 'generateAudioCues',
  description:
    'Generates audio cues (music, SFX, ambient) from a shot list. Each cue has a type, generative prompt, start shot sequence, offset, and duration. Cues flow across shot boundaries to create a cohesive audio landscape.',
  parameters: z.object({
    shotsJson: z
      .union([z.string(), z.array(z.any())])
      .transform((val) => (typeof val === 'string' ? val : JSON.stringify(val)))
      .describe(
        'JSON array of shot data — each element must have seq, duration, audioDesc, and action fields. Can be a JSON string or array.',
      ),
    sceneHeading: z
      .string()
      .default('Full Episode Sequence')
      .describe(
        'Scene heading for context. Defaults to "Full Episode Sequence" when generating cues for the entire episode.',
      ),
  }),
  execute: async ({ shotsJson, sceneHeading }, context) => {
    console.log(
      `[Audio Cue Director] Generating audio cues for: "${sceneHeading}"`,
    );

    try {
      const { executeLLM } = await import('@kit/prompt-engine/server');

      const result = await executeLLM<AudioCueResult>({
        templateSlug: 'scene-audio-refinement',
        variables: {
          scene_heading: sceneHeading,
          shots_json: shotsJson,
        },
        temperature: 0.2,
        context: {
          name: 'agent.audioCueDirector.generateAudioCues',
          accountId: context.accountId,
        },
      });

      const cues = result.data.cues;

      if (!Array.isArray(cues) || cues.length === 0) {
        return toolError(
          'Audio Cue Director returned 0 cues. Check the scene-audio-refinement prompt and shot data.',
        );
      }

      const musicCues = cues.filter((c) => c.type === 'music').length;
      const sfxCues = cues.filter((c) => c.type === 'sfx').length;
      const ambientCues = cues.filter((c) => c.type === 'ambient').length;

      console.log(
        `[Audio Cue Director] Generated ${cues.length} cues — ` +
          `music: ${musicCues}, sfx: ${sfxCues}, ambient: ${ambientCues}`,
      );

      return toolSuccess({
        cues,
        totalCues: cues.length,
        musicCues,
        sfxCues,
        ambientCues,
      });
    } catch (error) {
      const message = (error as Error).message;
      console.error(
        `[Audio Cue Director] Fatal error in generateAudioCues: ${message}`,
        error,
      );
      return toolError(`Audio Cue Director failed: ${message}`);
    }
  },

  // OPT-2: Drop the full cues array from history, keep only counts
  // Full cue data is preserved in the step trace (AgentStep.toolResult)
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    return {
      success: true,
      totalCues: d.totalCues,
      musicCues: d.musicCues,
      sfxCues: d.sfxCues,
      ambientCues: d.ambientCues,
    };
  },
});

export const audioCueDirectorSkill: Skill = {
  name: 'audio-cue-director',
  description:
    'Generates coherent audio cues (music, SFX, ambient) from a shot list. Cues flow across shot boundaries to create a cohesive audio landscape with proper timing and layering.',
  tools: [generateAudioCuesTool],
  contextPrompt: `You have access to an Audio Cue Director that generates coherent audio cues — music, SFX, and ambient — from visual shot data.

Each cue references shots by sequence number and includes:
- type: 'music' | 'sfx' | 'ambient'
- prompt: a generative audio prompt describing the sound
- startShotSequence: which shot the cue begins at
- startOffsetInShot: seconds into that shot where the cue starts
- durationSeconds: how long the cue plays

Cues are designed to flow across shot boundaries, creating layered audio that matches the visual pacing. Music cues provide emotional underpinning, SFX cues punctuate action moments, and ambient cues establish environmental presence.`,
  instructions: `1. Pass all shot data as a JSON array to generateAudioCues — each shot needs seq, duration, audioDesc, and action fields
2. Cues should cover the entire episode timeline without long silent gaps
3. Music cues typically span multiple shots; SFX cues are short and precise
4. Report totalCues and the breakdown by type to the Orchestrator`,
};
