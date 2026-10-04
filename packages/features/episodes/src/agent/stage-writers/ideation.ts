import { defineStageWriter } from '@kit/ai-gateway';
import { ideationOrchestratorInput, ideationStage } from '@kit/generation';

/**
 * The Ideation Orchestrator (generateIdeas → evaluateIdeas → regenerate
 * weak, max 1 cycle).
 */
export const ideationStageWriter = defineStageWriter(
  ideationStage,
  (_run, { ctx, target }) =>
    async (brief) => {
      const { runIdeationOrchestrator } = await import(
        '../ideation-orchestrator'
      );

      const orchestratorResult = await runIdeationOrchestrator({
        ...ideationOrchestratorInput(brief),
        episodeId: target.episodeId,
        accountId: ctx.accountId,
      });

      if (!orchestratorResult.success) {
        throw new Error(
          `Ideation Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      console.log(
        `[Story Ideation] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, Ideas: ${orchestratorResult.ideas.length}`,
      );

      return {
        output: { ideas: orchestratorResult.ideas },
        usage: { provider: 'orchestrator', model: 'multi-agent', tokens: 0 },
        diagnostics: {
          orchestratorSteps: orchestratorResult.orchestratorSteps,
        },
      };
    },
);
