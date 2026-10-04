/**
 * Story Generation Handler — Stage 1, on the generation core (FILM-1901).
 *
 * prepare (the `story` stage) builds the brief; `run.write` reaches the
 * stage's writer, which runs the Story Orchestrator (Story Director →
 * Viral Analyst → Continuity Guardian) and then extracts the canon facts
 * with `canon-extraction`; the stage's output
 * schema is enforced; commit writes story_data, status 'story', the canon
 * tables and the invented assets. Stage 2 (screenplay-conversion) is
 * triggered by user action on the Story tab.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EpisodeViralQuality } from '@kit/episodes/lib';
import { runStage, storyStage } from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import { calculateContentScaling } from '@kit/shared/duration-scaling';
import type { Database } from '@kit/supabase/database';

import { stageRunDeps, workerCtx } from '../utils/stage-runtime';

interface StoryOutput {
  fullText: string;
  title: string;
  actBreakdown: Array<{ act: number; summary: string }>;
  characters: string[];
  themes: string[];
  tone: string;
  estimatedSceneCount: number;
  episodeSummary?: string;
  sentimentScore?: number;
  keyEvents?: string[];
}

interface StoryGenerationResult {
  success: boolean;
  data: {
    story: StoryOutput;
    episode: {
      id: string;
      status: string;
      version: number;
    };
    metadata: {
      provider: string;
      model: string;
      costCents: number;
      tokensUsed: number;
      generatedAt: string;
      orchestratorSteps?: number;
    };
  };
}

export async function processStoryGeneration(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<StoryGenerationResult> {
  const data = parseLlmJobPayload('story-generation', payload);

  console.log(
    `[Story Generation] Starting AGENTIC pipeline for episode ${data.episodeId}`,
  );

  const ctx = workerCtx(supabase, data);
  const target = storyStage.targetSchema.parse(data);

  const { commit, run } = await runStage(
    storyStage,
    ctx,
    target,
    stageRunDeps(),
  );
  const {
    characterNames = [],
    viralQuality,
    orchestratorSteps,
  } = (run.diagnostics ?? {}) as {
    characterNames?: string[];
    viralQuality?: EpisodeViralQuality;
    orchestratorSteps?: number;
  };

  if (commit.status === 'skipped') {
    console.warn(`[Story Generation] Skipping write: ${commit.reason}`);

    return {
      success: false,
      data: {
        story: {
          fullText: '',
          title: data.title,
          actBreakdown: [],
          characters: [],
          themes: [],
          tone: '',
          estimatedSceneCount: 0,
        },
        episode: { id: data.episodeId, status: 'draft', version: 0 },
        metadata: {
          provider: 'skipped',
          model: 'skipped',
          costCents: 0,
          tokensUsed: 0,
          generatedAt: new Date().toISOString(),
        },
      },
    };
  }

  console.log(
    `[Story Generation] Stage 1 complete. Status: story. ` +
      `Viral score: ${viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}. ` +
      `Stage 2 (Screenplay) will run on user action.`,
  );

  const scaling = calculateContentScaling({
    targetDurationSeconds: target.targetDuration,
    contentStyle: target.contentStyle,
  });

  // Synthesize a StoryOutput for the return value
  const story: StoryOutput = {
    fullText: commit.data.storyData.fullStory as string,
    title: data.title,
    actBreakdown: [],
    characters: characterNames,
    themes: [],
    tone: target.contentStyle,
    estimatedSceneCount: scaling.screenplay.sceneCountMin,
    episodeSummary: viralQuality?.whyThisWorks,
    sentimentScore: viralQuality?.overallScore,
  };

  return {
    success: true,
    data: {
      story,
      episode: commit.data.episode,
      metadata: {
        provider: 'orchestrator',
        model: 'multi-agent',
        costCents: 0, // Orchestrator tracks cost internally
        tokensUsed: 0,
        generatedAt: commit.data.generatedAt,
        orchestratorSteps,
      },
    },
  };
}
