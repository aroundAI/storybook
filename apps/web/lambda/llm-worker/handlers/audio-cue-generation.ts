/**
 * Audio Cue Generation Handler
 *
 * The `audio_cues` stage of `@kit/generation` (FILM-1901): prepare → the
 * stage's writer, reached through `run.write`: the Audio Cue Orchestrator (generate → evaluate coverage, gaps and overlaps →
 * revise once) → outputSchema and check per scene part → commit, which
 * inserts `audio_cues`. Runs after shot generation so music and SFX flow
 * across shot boundaries.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  type AudioCuesTarget,
  audioCuesStage,
  runStage,
} from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

export async function processAudioCueGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<{ success: boolean; cuesCreated: number }> {
  const data = parseLlmJobPayload('audio-cue-generation', payload);

  console.log(
    `[Audio Generation] Starting AGENTIC pipeline for episode ${data.episodeId}`,
  );

  const target: AudioCuesTarget = {
    episodeId: data.episodeId,
    projectId: data.projectId,
    accountId: data.accountId,
    userId: data.userId,
  };

  try {
    const { commit } = await runStage(
      audioCuesStage,
      workerCtx(supabase, {
        accountId: data.accountId,
        userId: data.userId ?? '',
      }),
      target,
      stageRunDeps(),
    );

    return { success: true, cuesCreated: commit.data.cuesCreated };
  } catch (error) {
    console.error('[Audio Generation] Failed:', error);
    throw error;
  }
}
