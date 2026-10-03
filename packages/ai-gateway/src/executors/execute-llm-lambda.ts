/**
 * The worker's executor (moved from apps/web/lambda/llm-worker/llm-utils.ts
 * in FILM-1902 part B): the embedded registry, one call, no retries, the
 * reply's JSON extracted and the wrapper key unwrapped. It now requires a
 * run: the one passed, or the one the worker put in scope with `withRun`.
 * Before the model call the run must be an open server run; every call
 * writes llm_usage_analytics with the run id.
 */
import type { RunHandle } from '@kit/generation';
import { LLMError } from '@kit/llm';

import { assertServerRunOpen } from '../guard';
import { loadAndRenderPromptForLambda } from '../prompts/lambda-registry';
import { requireRun } from '../run-context';
import { extractJSON } from './extract-json';
import { resolveModelClient } from './model-client';
import { recordUsage } from './usage';

export interface LambdaExecutorConfig {
  templateSlug: string;
  variables: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  /** The run this call is for; defaults to the run in scope */
  run?: RunHandle;
  /** Who to charge, when not the run's user */
  userId?: string;
  /** Defaults to the template slug */
  operationName?: string;
}

export interface LambdaExecutorResult<T> {
  data: T;
  metadata: {
    tokens: number;
    latency: number;
    provider: string;
    model: string;
  };
}

export async function executeLLMForLambda<T = unknown>(
  config: LambdaExecutorConfig,
): Promise<LambdaExecutorResult<T>> {
  const run = requireRun(
    `executeLLMForLambda(${config.templateSlug})`,
    config.run,
  );

  await assertServerRunOpen(run);

  const startTime = Date.now();
  const usage = {
    userId: config.userId,
    templateSlug: config.templateSlug,
    operationName: config.operationName ?? config.templateSlug,
  };
  // Known once the prompt is rendered; the failure row carries the last value
  let provider = 'unknown';
  let model = 'unknown';

  try {
    const rendered = loadAndRenderPromptForLambda(
      config.templateSlug,
      config.variables,
    );

    console.log(
      `[LLM Lambda] Loaded prompt: ${config.templateSlug} v${rendered.version} for run ${run.id}`,
    );

    let systemPromptContent = rendered.systemPrompt;
    if (rendered.output?.schema_for_llm) {
      systemPromptContent +=
        '\n\n**Expected Output Schema:**\n' + rendered.output.schema_for_llm;
    }

    const messages = [
      { role: 'system' as const, content: systemPromptContent },
      { role: 'user' as const, content: rendered.userPrompt },
    ];

    const resolved = resolveModelClient(rendered.llmConfig, {
      requireKey: true,
    });
    provider = resolved.provider;
    model = resolved.model;

    console.log(`[LLM Lambda] Creating client: ${provider}/${model}`);

    const maxTokens = config.maxTokens ?? rendered.llmConfig.max_tokens ?? 4000;
    const temperature =
      config.temperature ?? rendered.llmConfig.temperature ?? 0.5;

    console.log(
      `[LLM Lambda] Executing with maxTokens=${maxTokens}, temperature=${temperature}`,
    );

    const response = await resolved.client.createChatCompletion({
      messages,
      temperature,
      maxTokens,
    });

    const latency = Date.now() - startTime;
    console.log(
      `[LLM Lambda] Got response in ${latency}ms, tokens=${response.usage.totalTokens}`,
    );

    const responseType = rendered.output?.type || 'object';
    const wrapperKey = rendered.output?.wrapper_key;

    let data: T;
    if (responseType === 'text') {
      data = (response.message.content ?? '') as T;
    } else {
      const fullData = extractJSON<unknown>(
        response.message.content ?? '',
        responseType,
      );

      if (wrapperKey) {
        if (
          typeof fullData !== 'object' ||
          fullData === null ||
          !(wrapperKey in fullData)
        ) {
          throw new Error(`Key "${wrapperKey}" not found in response`);
        }
        data = (fullData as Record<string, unknown>)[wrapperKey] as T;
      } else {
        data = fullData as T;
      }
    }

    await recordUsage(run, {
      ...usage,
      llmProvider: provider,
      llmModel: model,
      promptTokens: response.usage.promptTokens,
      completionTokens: response.usage.completionTokens,
      totalTokens: response.usage.totalTokens,
      promptCost: response.cost?.prompt,
      completionCost: response.cost?.completion,
      totalCost: response.cost?.total,
      latencyMs: latency,
      status: 'success',
      requestConfig: {
        temperature,
        maxTokens,
        responseFormat: rendered.llmConfig.response_format,
      },
      responseMetadata: { finishReason: response.finishReason },
    });

    return {
      data,
      metadata: {
        tokens: response.usage.totalTokens,
        latency,
        provider,
        model,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Log the call (failure), then let the job fail as before
    await recordUsage(run, {
      ...usage,
      llmProvider: provider,
      llmModel: model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startTime,
      status: 'failure',
      errorCode:
        error instanceof LLMError
          ? (error.code ?? 'UNKNOWN_ERROR')
          : 'UNKNOWN_ERROR',
      errorMessage: errorMessage.substring(0, 1000),
    });

    throw error;
  }
}
