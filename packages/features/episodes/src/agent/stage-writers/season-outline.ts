import { defineStageWriter } from '@kit/ai-gateway';
import {
  seasonOutlineOrchestratorInput,
  seasonOutlineStage,
} from '@kit/generation';

/**
 * The Season Orchestrator (generateSeasonOutline → evaluateSeasonArc →
 * revise weak episodes, max 1 cycle). Its arc evaluation goes into the
 * output and, for the job's reply, the run's diagnostics.
 */
export const seasonOutlineStageWriter = defineStageWriter(
  seasonOutlineStage,
  (_run, { ctx, target }) =>
    async (brief) => {
      const { runSeasonOrchestrator } = await import('../season-orchestrator');

      const orchestratorResult = await runSeasonOrchestrator({
        ...seasonOutlineOrchestratorInput(brief),
        projectId: target.projectId,
        accountId: ctx.accountId,
      });

      if (!orchestratorResult.success) {
        throw new Error(
          `Season Orchestrator failed: ${orchestratorResult.error ?? 'Unknown error'}`,
        );
      }

      const evaluation = {
        arcScore: orchestratorResult.arcScore,
        arcSummary: orchestratorResult.arcSummary,
        orchestratorSteps: orchestratorResult.orchestratorSteps,
      };

      console.log(
        `[Season Outline] Agentic pipeline complete. Steps: ${orchestratorResult.orchestratorSteps}, ` +
          `Episodes: ${orchestratorResult.episodes.length}, Arc score: ${orchestratorResult.arcScore?.toFixed(2) ?? 'N/A'}`,
      );

      return {
        output: { episodes: orchestratorResult.episodes, evaluation },
        usage: { provider: 'orchestrator', model: 'multi-agent', tokens: 0 },
        diagnostics: evaluation,
      };
    },
);
