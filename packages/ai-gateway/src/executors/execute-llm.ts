/**
 * The prompt-engine executor (moved from
 * packages/features/prompt-engine/src/lib/server/llm-executor.ts in
 * FILM-1902 part B): the package registry, network retries with backoff,
 * JSON retries with a bigger token budget on truncation, the prompt file's
 * Zod schema, and the wrapper key. It now requires a run: the one passed,
 * or the one in scope with `withRun`. Before the model call the run must be
 * an open server run; every call writes llm_usage_analytics with the run id.
 *
 * A library, not a `'use server'` module (KB-58), and no `server-only`: the
 * LLM worker imports this through the gateway.
 */
import { z } from 'zod';

import type { RunHandle } from '@kit/generation';
import { LLMError } from '@kit/llm';
import { normalizeSceneShotData } from '@kit/prompt-engine/normalize-llm-output';
import { loadAndRenderPrompt } from '@kit/prompt-engine/server';
import type {
  LLMExecutionConfig,
  LLMExecutionResult,
} from '@kit/prompt-engine/types';
import { getLogger } from '@kit/shared/logger';

import { assertServerRunOpen } from '../guard';
import { requireRun } from '../run-context';
import { extractJSON } from './extract-json';
import { resolveModelClient } from './model-client';
import { recordUsage } from './usage';

/**
 * JSON parse retry configuration
 * When JSON extraction fails (truncated response), retry with higher max_tokens
 */
const MAX_JSON_RETRIES = 2;
const JSON_RETRY_TOKEN_MULTIPLIER = 1.5; // Increase tokens by 50% on each retry

/**
 * Retry helper for network-related LLM failures
 * Implements exponential backoff for transient errors
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  logger: Awaited<ReturnType<typeof getLogger>>,
  context: Record<string, unknown>,
  options: {
    maxRetries: number;
    retryDelay: number;
    retryableErrors: string[];
  },
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode = (error as { code?: string }).code;

      const isRetryable = options.retryableErrors.some(
        (code) => errorMessage.includes(code) || errorCode === code,
      );

      if (!isRetryable || attempt === options.maxRetries) {
        throw error;
      }

      // Exponential backoff: 2s, 4s, 8s, 16s, 32s
      const delay = options.retryDelay * Math.pow(2, attempt);

      logger.warn(
        {
          ...context,
          attempt: attempt + 1,
          maxRetries: options.maxRetries,
          delay,
          error: errorMessage,
          errorCode,
        },
        'Retrying LLM request after network error',
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

const RETRYABLE_ERRORS = [
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_SOCKET_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENOTFOUND',
  'Premature close',
  'Connection closed',
  'socket hang up',
  'Socket timeout',
  'EHOSTUNREACH',
  'fetch failed',
  'network error',
  // Gemini / Google API transient capacity errors
  'UNAVAILABLE',
  'high demand',
  '503',
  'overloaded',
  'Resource has been exhausted',
  // Rate limit errors (429)
  '429',
  'Too Many Requests',
  'RATE_LIMIT_EXCEEDED',
  'RESOURCE_EXHAUSTED',
  'quota',
];

export interface GatewayExecutorConfig extends LLMExecutionConfig {
  /** The run this call is for; defaults to the run in scope */
  run?: RunHandle;
}

/**
 * Centralized LLM execution utility (file-based prompts)
 *
 * Reads all configuration from the prompt JSON file: template and
 * variables, provider, model, max_tokens and temperature, output structure
 * and wrapper key, the Zod schema when the file has one, and the system
 * prompt composition. The prompt JSON file is the single source of truth
 * for all execution config; the run decides whether a model is called.
 */
export async function executeLLM<T = unknown>(
  config: GatewayExecutorConfig,
): Promise<LLMExecutionResult<T>> {
  const run = requireRun(`executeLLM(${config.templateSlug})`, config.run);

  await assertServerRunOpen(run);

  const logger = await getLogger();
  const context = { ...config.context, runId: run.id };

  logger.info(
    context,
    `Starting LLM execution (file-based): ${config.templateSlug}`,
  );

  // Define variables outside try block for catch block access
  let provider = 'unknown';
  let model = 'unknown';
  const startTime = Date.now();

  try {
    // 1. Load and render prompt from JSON file
    const rendered = await loadAndRenderPrompt(
      config.templateSlug,
      config.variables,
    );

    logger.info(
      {
        ...context,
        promptVersion: rendered.version,
        llmProvider: rendered.llmConfig.provider,
        llmModel: rendered.llmConfig.model,
      },
      'Loaded and rendered prompt from file',
    );

    // 2. Build messages array (system + user), with schema_for_llm appended
    let systemPromptContent = rendered.systemPrompt;

    if (rendered.output?.schema_for_llm) {
      systemPromptContent +=
        '\n\n**Expected Output Schema:**\n' + rendered.output.schema_for_llm;

      logger.info(
        {
          ...context,
          schemaInjected: true,
          schemaLength: rendered.output.schema_for_llm.length,
        },
        'Injected schema_for_llm into system prompt',
      );
    }

    const messages = [
      { role: 'system' as const, content: systemPromptContent },
      { role: 'user' as const, content: rendered.userPrompt },
    ];

    logger.info(
      {
        ...context,
        systemPromptLength: systemPromptContent.length,
        userPromptLength: rendered.userPrompt.length,
        schemaInjected: !!rendered.output?.schema_for_llm,
      },
      'Built messages array from rendered prompts',
    );

    // 3. Create LLM client
    const resolved = resolveModelClient(rendered.llmConfig);
    provider = resolved.provider;
    model = resolved.model;
    const llm = resolved.client;

    // 4. Execute LLM call (use config from JSON or override)
    const resolvedMaxTokens =
      config.maxTokens ?? rendered.llmConfig.max_tokens ?? 2000;
    const temperature =
      config.temperature ?? rendered.llmConfig.temperature ?? 0.5;

    logger.info(
      {
        ...context,
        templateSlug: config.templateSlug,
        configMaxTokens: config.maxTokens,
        renderedMaxTokens: rendered.llmConfig.max_tokens,
        resolvedMaxTokens,
      },
      'Resolved maxTokens for LLM call',
    );

    // Log request size to identify potentially problematic large requests
    const promptLength =
      systemPromptContent.length + rendered.userPrompt.length;
    const estimatedTokens = Math.ceil(promptLength / 3); // Rough estimate: 3 chars per token

    if (estimatedTokens > 15000 || promptLength > 45000) {
      logger.warn(
        {
          ...context,
          promptLength,
          estimatedTokens,
          maxTokens: resolvedMaxTokens,
          totalEstimatedTokens: estimatedTokens + resolvedMaxTokens,
        },
        'Large prompt detected - may cause network instability with some providers',
      );
    }

    // Auto-detect response structure from output config (needed for retry loop)
    const outputConfig = rendered.output;
    const responseType = outputConfig?.type || 'object'; // Default to object
    const wrapperKey = outputConfig?.wrapper_key;

    logger.info(
      {
        ...context,
        responseType,
        wrapperKey,
        hasSchema: !!outputConfig?.schema,
      },
      'Auto-detected output configuration from prompt file',
    );

    // Execute LLM call with JSON parse retry (escalates max_tokens on truncation)
    let fullData: unknown;
    // Using definite assignment assertion (!) since the loop always executes at least once
    let response!: Awaited<ReturnType<typeof llm.createChatCompletion>>;
    let latency!: number;
    let currentMaxTokens = resolvedMaxTokens;

    for (
      let jsonRetryAttempt = 0;
      jsonRetryAttempt <= MAX_JSON_RETRIES;
      jsonRetryAttempt++
    ) {
      // Execute LLM call with retry logic for network errors
      response = await executeWithRetry(
        () =>
          llm.createChatCompletion({
            messages,
            temperature,
            maxTokens: currentMaxTokens,
          }),
        logger,
        context,
        {
          maxRetries: 5,
          retryDelay: 2000, // 2s, 4s, 8s, 16s, 32s with exponential backoff
          retryableErrors: RETRYABLE_ERRORS,
        },
      );
      latency = Date.now() - startTime;

      logger.info(
        {
          ...context,
          latency,
          tokens: response.usage.totalTokens,
          cost: response.cost?.total,
          provider,
          model,
          maxTokens: currentMaxTokens,
          jsonRetryAttempt:
            jsonRetryAttempt > 0 ? jsonRetryAttempt + 1 : undefined,
        },
        `LLM execution completed: ${config.templateSlug}`,
      );

      const responseContent = response.message.content ?? '';
      logger.info(
        {
          ...context,
          responseLength: responseContent.length,
          provider,
          model,
        },
        responseType === 'text'
          ? 'LLM response received - returning as plain text'
          : 'LLM response received - attempting JSON extraction',
      );

      // For text output type, skip JSON extraction and return raw content
      if (responseType === 'text') {
        fullData = responseContent;
        break;
      }

      // Try to extract JSON
      try {
        fullData = extractJSON<unknown>(responseContent, responseType);
        break;
      } catch (extractionError) {
        const errorMessage =
          extractionError instanceof Error
            ? extractionError.message
            : 'Unknown error';

        // A syntax error or a missing closing brace is a truncated reply
        const isJsonSyntaxError = errorMessage.includes('Invalid JSON syntax');
        const isTruncationError =
          errorMessage.includes('No object found') ||
          errorMessage.includes('No array found');

        if (
          (isJsonSyntaxError || isTruncationError) &&
          jsonRetryAttempt < MAX_JSON_RETRIES
        ) {
          const nextMaxTokens = Math.ceil(
            currentMaxTokens * JSON_RETRY_TOKEN_MULTIPLIER,
          );

          logger.warn(
            {
              ...context,
              jsonRetryAttempt: jsonRetryAttempt + 1,
              maxJsonRetries: MAX_JSON_RETRIES,
              currentMaxTokens,
              nextMaxTokens,
              responseLength: responseContent.length,
              error: errorMessage,
            },
            'JSON parse failed (likely truncation) - retrying with higher max_tokens',
          );

          currentMaxTokens = nextMaxTokens;
          continue;
        }

        // Log full request and response on final extraction failure
        logger.error(
          {
            ...context,
            requestMessages: messages.map((m) => ({
              role: m.role,
              contentLength: (m.content ?? '').length,
              contentFull: m.content ?? '',
            })),
            requestConfig: {
              temperature,
              maxTokens: currentMaxTokens,
              responseFormat: rendered.llmConfig.response_format,
            },
            responseContentFull: responseContent,
            responseLength: responseContent.length,
            provider,
            model,
            extractionError: errorMessage,
            expectedResponseType: responseType,
            wrapperKey,
            jsonRetryAttempt: jsonRetryAttempt + 1,
            maxJsonRetries: MAX_JSON_RETRIES,
          },
          'JSON extraction failed after all retries - full request and response logged',
        );

        throw extractionError;
      }
    }

    // 8. Normalize data before validation (for specific templates)
    // This fixes common LLM output variations like "medium shot" → "medium"
    if (config.templateSlug.includes('scene-shot-generation')) {
      logger.info(context, 'Normalizing scene shot data');
      fullData = normalizeSceneShotData(fullData);
    }

    // 9. Validate with Zod schema if provided and validation enabled
    if (
      outputConfig?.schema?.type === 'zod' &&
      config.validateSchema !== false
    ) {
      try {
        // Evaluate Zod schema string with z in scope (safe in server context)
        const schemaFn = eval(
          `(function(z) { return ${outputConfig.schema.definition}; })`,
        )(z);

        logger.info(
          {
            ...context,
            schemaDefinition: outputConfig.schema.definition.substring(0, 100),
          },
          'Validating response with Zod schema',
        );

        const validated = schemaFn.parse(fullData);
        fullData = validated;

        logger.info(context, 'Schema validation passed');
      } catch (validationError) {
        logger.error(
          {
            ...context,
            validationError:
              validationError instanceof Error
                ? validationError.message
                : 'Unknown validation error',
            dataPreview: JSON.stringify(fullData).substring(0, 500),
          },
          'Zod schema validation failed',
        );

        throw new Error(
          `Schema validation failed: ${validationError instanceof Error ? validationError.message : 'Unknown error'}`,
        );
      }
    }

    // 10. Extract wrapper array if needed (after validation)
    let data: T;
    if (wrapperKey) {
      if (
        typeof fullData !== 'object' ||
        fullData === null ||
        !(wrapperKey in fullData)
      ) {
        throw new Error(
          `Key "${wrapperKey}" not found in validated response object`,
        );
      }

      const value = (fullData as Record<string, unknown>)[wrapperKey];
      if (!Array.isArray(value)) {
        throw new Error(`Value for key "${wrapperKey}" is not an array`);
      }

      data = value as T;
    } else {
      data = fullData as T;
    }

    // 11. Log analytics (success), with the run id
    await recordUsage(run, {
      userId: config.context.userId,
      templateSlug: config.templateSlug,
      operationName: config.context.name,
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
        maxTokens: resolvedMaxTokens,
        responseFormat: rendered.llmConfig.response_format,
      },
      responseMetadata: {
        finishReason: response.finishReason,
      },
    });

    return {
      data,
      metadata: {
        latency,
        tokens: response.usage.totalTokens,
        cost: response.cost?.total,
        provider,
        model,
      },
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    logger.error(
      {
        ...context,
        error: errorMessage,
        errorType: error?.constructor?.name,
      },
      `LLM execution failed: ${config.templateSlug}`,
    );

    await recordUsage(run, {
      userId: config.context.userId,
      templateSlug: config.templateSlug,
      operationName: config.context.name,
      llmProvider: provider,
      llmModel: model,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      latencyMs: Date.now() - startTime,
      status: 'failure',
      errorCode: error instanceof LLMError ? error.code : 'UNKNOWN_ERROR',
      errorMessage: errorMessage.substring(0, 1000),
    });

    throw error;
  }
}
