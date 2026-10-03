/**
 * The write function `@kit/agent`'s runner takes from a run (FILM-1902
 * criterion 5): one chat completion per agent step, checked against the run
 * before the call and logged to llm_usage_analytics with the run id. The
 * runner itself no longer sees a provider.
 */
import type {
  AgentStepRequest,
  AgentStepResponse,
  AgentStepWriter,
} from '@kit/agent';
import type { RunHandle } from '@kit/generation';
import { LLMError } from '@kit/llm';

import { resolveModelClient } from './executors/model-client';
import { recordUsage } from './executors/usage';
import { assertServerRunOpen } from './guard';
import { requireRun } from './run-context';

export function agentStepWriter(run: RunHandle): AgentStepWriter {
  return async (request: AgentStepRequest): Promise<AgentStepResponse> => {
    await assertServerRunOpen(run);

    const resolved = resolveModelClient({
      provider: request.provider ?? 'gemini',
      model: request.model ?? 'gemini-3.1-flash-lite',
    });
    const started = Date.now();
    const usageBase = {
      templateSlug: `agent/${request.agentName}`,
      operationName: request.agentName,
      llmProvider: resolved.provider,
      llmModel: resolved.model,
      requestConfig: {
        step: request.step,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      },
    };

    try {
      const response = await resolved.client.createChatCompletion({
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens,
      });

      const latencyMs = Date.now() - started;

      await recordUsage(run, {
        ...usageBase,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
        promptCost: response.cost?.prompt,
        completionCost: response.cost?.completion,
        totalCost: response.cost?.total,
        latencyMs,
        status: 'success',
        responseMetadata: { finishReason: response.finishReason },
      });

      return {
        content: response.message.content ?? '',
        provider: resolved.provider,
        model: resolved.model,
        usage: response.usage,
        cost: response.cost,
        finishReason: response.finishReason,
      };
    } catch (error) {
      await recordUsage(run, {
        ...usageBase,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: Date.now() - started,
        status: 'failure',
        errorCode:
          error instanceof LLMError
            ? (error.code ?? 'UNKNOWN_ERROR')
            : 'UNKNOWN_ERROR',
        errorMessage: (error instanceof Error
          ? error.message
          : String(error)
        ).substring(0, 1000),
      });

      throw error;
    }
  };
}

/**
 * The writer for whatever run is in scope, resolved at each step: the
 * worker installs this as the runner's default (`setAgentStepWriter`), so an
 * orchestrator inside `withRun` reaches the model for its run, and one
 * outside any run is refused (LLM_NO_RUN) before a call is made.
 */
export const agentStepWriterForCurrentRun: AgentStepWriter = (request) =>
  agentStepWriter(requireRun(`agent ${request.agentName}`))(request);
