/**
 * Story Refinement Handler
 *
 * Refines an existing story based on user feedback. The work is the
 * `story_refinement` stage of `@kit/generation` (FILM-1901): prepare builds
 * the brief, the run writes (FILM-1902), the output is checked against the stage's
 * schema, and commit saves `story_data`, keeps the previous story for undo,
 * records the refinement history and closes the generation_jobs row.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { runStage, storyRefinementStage } from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface StoryRefinementResult {
  success: boolean;
  data: {
    story: Record<string, unknown>;
    refinementApplied: boolean;
    episode: {
      id: string;
      status: string;
    };
    metadata: {
      provider: string;
      model: string;
      generatedAt: string;
    };
  };
}

export async function processStoryRefinement(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<StoryRefinementResult> {
  const data = parseLlmJobPayload('story-refinement', payload);

  console.log(`[Story Refinement] Processing for episode ${data.episodeId}`);

  const { commit, usage } = await runStage(
    storyRefinementStage,
    workerCtx(supabase, data),
    { episodeId: data.episodeId, feedback: data.feedback },
    stageRunDeps(),
  );

  const generatedAt = new Date().toISOString();

  if (commit.status === 'skipped') {
    return {
      success: false,
      data: {
        story: {},
        refinementApplied: false,
        episode: commit.data.episode,
        metadata: { provider: 'skipped', model: 'skipped', generatedAt },
      },
    };
  }

  return {
    success: true,
    data: {
      story: commit.data.story,
      refinementApplied: true,
      episode: commit.data.episode,
      metadata: {
        provider: usage?.provider ?? 'unknown',
        model: usage?.model ?? 'unknown',
        generatedAt,
      },
    },
  };
}
