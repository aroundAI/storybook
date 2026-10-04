import { defineStageWriter } from '@kit/ai-gateway';
import { storyOrchestratorInput, storyStage } from '@kit/generation';

import { extractCanonFacts } from './story-canon-facts';

/**
 * The Story Orchestrator (Story Director → Viral Analyst → Continuity
 * Guardian), then the canon facts commit stores, extracted with
 * `canon-extraction`: the second model call of this stage (FILM-1901
 * criterion 9). An external agent submits those with the story.
 */
export const storyStageWriter = defineStageWriter(
  storyStage,
  (_run, { ctx, target }) =>
    async (brief) => {
      const input = storyOrchestratorInput(brief);
      const { characterNames } = brief.context.episode as {
        characterNames: string[];
      };

      console.log(
        `[Story Generation] Context built: ${characterNames.length} characters` +
          (input.recurringElementsContext ? ', recurring element: yes' : '') +
          (input.contentType ? `, type: ${input.contentType}` : '') +
          (input.verifiedFacts ? ', episode facts: yes' : ''),
      );

      const { runStoryOrchestrator } = await import('../story-orchestrator');

      const orchestratorResult = await runStoryOrchestrator(
        {
          ...input,
          episodeId: target.episodeId,
          projectId: target.projectId,
          accountId: ctx.accountId,
        },
        ctx.client,
      );

      if (!orchestratorResult.success) {
        throw new Error(
          `Story Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      console.log(
        `[Story Generation] Stage 1 complete. Steps: ${orchestratorResult.orchestratorSteps}, Viral score: ${orchestratorResult.viralQuality?.overallScore?.toFixed(2) ?? 'N/A'}`,
      );

      const viralQuality = orchestratorResult.viralQuality ?? undefined;
      const orchestratorSteps = orchestratorResult.orchestratorSteps;
      const storyText = orchestratorResult.storyText ?? '';

      const canonFacts = await extractCanonFacts({
        projectId: target.projectId,
        accountId: ctx.accountId,
        storyContent: storyText,
        supabase: ctx.client,
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
        usage: { provider: 'orchestrator', model: 'multi-agent', tokens: 0 },
        // The job's reply names the project's characters the story was
        // written with, and the orchestrator's own figures
        diagnostics: { characterNames, viralQuality, orchestratorSteps },
      };
    },
);
