/**
 * Story Generation Handler — Stage 1, on the generation core (FILM-1901).
 *
 * prepare (the `story` stage) builds the brief; generate runs the Story
 * Orchestrator (Story Director → Viral Analyst → Continuity Guardian) and
 * then extracts the canon facts with `canon-extraction`; the stage's output
 * schema is enforced; commit writes story_data, status 'story', the canon
 * tables and the invented assets. Stage 2 (screenplay-conversion) is
 * triggered by user action on the Story tab.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { EpisodeViralQuality } from '@kit/episodes/lib';
import { runStage, storyOrchestratorInput, storyStage } from '@kit/generation';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import { calculateContentScaling } from '@kit/shared/duration-scaling';
import type { Database } from '@kit/supabase/database';

import { extractCanonFacts } from '../utils/commit-story-canon';
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

  let characterNames: string[] = [];
  let viralQuality: EpisodeViralQuality | undefined;
  let orchestratorSteps: number | undefined;

  const { commit } = await runStage(storyStage, ctx, target, {
    ...stageRunDeps(),
    generate: async (brief) => {
      const input = storyOrchestratorInput(brief);
      const episode = brief.context.episode as { characterNames: string[] };
      characterNames = episode.characterNames;

      console.log(
        `[Story Generation] Context built: ${characterNames.length} characters` +
          (input.recurringElementsContext ? ', recurring element: yes' : '') +
          (input.contentType ? `, type: ${input.contentType}` : '') +
          (input.verifiedFacts ? ', episode facts: yes' : ''),
      );

      const { runStoryOrchestrator } = await import(
        '@kit/episodes/agent/story-orchestrator'
      );

      const orchestratorResult = await runStoryOrchestrator(
        {
          ...input,
          episodeId: target.episodeId,
          projectId: target.projectId,
          accountId: data.accountId,
        },
        supabase,
      );

      if (!orchestratorResult.success) {
        throw new Error(
          `Story Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      console.log(
        `[Story Generation] Stage 1 complete. Steps: ${orchestratorResult.orchestratorSteps}, Viral score: ${orchestratorResult.viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}`,
      );

      viralQuality = orchestratorResult.viralQuality ?? undefined;
      orchestratorSteps = orchestratorResult.orchestratorSteps;

      const storyText = orchestratorResult.storyText ?? '';

      // The second model call of this stage: the canon facts commit stores
      // (criterion 9). An external agent submits these with the story.
      const canonFacts = await extractCanonFacts({
        projectId: target.projectId,
        accountId: data.accountId,
        storyContent: storyText,
        supabase,
      });

      return {
        output: {
          story: {
            title: orchestratorResult.storyTitle ?? target.title,
            fullText: storyText,
            actBreakdown: orchestratorResult.actBreakdown,
            characters: orchestratorResult.storyCharacters,
            themes: orchestratorResult.themes,
            tone: orchestratorResult.tone,
            estimatedSceneCount: orchestratorResult.estimatedSceneCount,
            episodeSummary: orchestratorResult.episodeSummary,
            sentimentScore: orchestratorResult.sentimentScore,
            keyEvents: orchestratorResult.keyEvents,
            viralStructure: orchestratorResult.viralStructure,
          },
          newCharacters: orchestratorResult.newCharacters ?? [],
          newLocations: orchestratorResult.newLocations ?? [],
          canonFacts: canonFacts ?? undefined,
          evaluation: {
            viralQuality: viralQuality ? { ...viralQuality } : undefined,
            orchestratorSteps,
          },
        },
        usage: {
          provider: 'orchestrator',
          model: 'multi-agent',
          tokens: 0,
        },
      };
    },
  });

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
