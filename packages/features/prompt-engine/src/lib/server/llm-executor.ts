'use server';

import { z } from 'zod';

import type { LLMProvider } from '@kit/llm';
import { LLMError, createLLMClient, logLLMUsage } from '@kit/llm';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';

import type { LLMExecutionConfig, LLMExecutionResult } from '../types';
import { loadAndRenderPrompt } from './prompt-loader';

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

      // Check if error is retryable (network/connection errors)
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const errorCode = (error as { code?: string }).code;

      const isRetryable = options.retryableErrors.some(
        (code) => errorMessage.includes(code) || errorCode === code,
      );

      if (!isRetryable || attempt === options.maxRetries) {
        // Not retryable or max retries reached - throw immediately
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

  // Should never reach here, but TypeScript needs this
  throw lastError!;
}

/**
 * Finds balanced JSON by counting braces/brackets, respecting string literals
 * This handles trailing garbage that greedy regex would incorrectly capture
 */
function findBalancedJSON(
  content: string,
  type: 'array' | 'object',
): string | null {
  const openChar = type === 'array' ? '[' : '{';
  const closeChar = type === 'array' ? ']' : '}';

  const startIndex = content.indexOf(openChar);
  if (startIndex === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIndex; i < content.length; i++) {
    const char = content[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === '\\' && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === openChar) depth++;
      else if (char === closeChar) {
        depth--;
        if (depth === 0) {
          return content.substring(startIndex, i + 1);
        }
      }
    }
  }

  return null; // Unbalanced - no matching close found
}

/**
 * JSON extraction utility with resilient parsing
 * Extracts JSON from LLM response content, handling:
 * - Markdown code fences
 * - DeepSeek <think> blocks
 * - Trailing garbage after valid JSON
 */
function extractJSON<T = unknown>(
  content: string,
  type: 'array' | 'object',
): T {
  // Remove markdown code fences if present
  let cleaned = content.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1]!.trim();
  }

  // Remove DeepSeek Reasoner <think> blocks (appears before JSON output)
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try balanced brace counting first (handles trailing garbage from LLMs)
  let jsonString = findBalancedJSON(cleaned, type);

  // Fall back to greedy regex if balanced parsing fails (backward compatibility)
  if (!jsonString) {
    const pattern = type === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
    const match = cleaned.match(pattern);
    if (match) jsonString = match[0].trim();
  }

  if (!jsonString) {
    throw new Error(
      `No ${type} found in LLM response. Response was: ${content.substring(0, 200)}...`,
    );
  }

  // Trim matched content before parsing to remove any whitespace
  const trimmedMatch = jsonString.trim();

  try {
    const parsed = JSON.parse(trimmedMatch);

    // Validate type matches expectation
    const actualType = Array.isArray(parsed) ? 'array' : 'object';
    if (actualType !== type) {
      throw new Error(`Expected ${type} but got ${actualType} in LLM response`);
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON syntax in LLM response: ${error.message}. Matched content: ${trimmedMatch.substring(0, 200)}...`,
      );
    }
    throw error;
  }
}

/**
 * Get API key for LLM provider from environment variables
 */
function getApiKeyForProvider(provider: LLMProvider | string): string {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY || '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY || '';
    case 'gemini':
      return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY || '';
    case 'local':
      return 'not-needed';
    default:
      return '';
  }
}

/**
 * Centralized LLM execution utility (file-based prompts)
 *
 * Automatically reads all configuration from prompt JSON file:
 * - Template loading and variable interpolation
 * - LLM provider, model, max_tokens, temperature from file
 * - Output structure (object/array), wrapper keys from file
 * - Zod schema validation if defined in file
 * - System prompt composition
 * - Complete request/response logging on errors
 *
 * The prompt JSON file is the single source of truth for all execution config.
 *
 * @example
 * ```typescript
 * // All config (max_tokens, responseType, wrapperKey, schema) comes from prompt file
 * const result = await executeLLM<{ clusters: ProblemCluster[] }>({
 *   templateSlug: 'cluster-problems-from-posts',
 *   variables: { post_count: 5, posts_context: '<posts>...</posts>' },
 *   context: { name: 'cluster-problems', accountId },
 *   // Optional overrides:
 *   temperature: 0.3,  // Override file's temperature
 *   maxTokens: 8000,   // Override file's max_tokens
 * });
 *
 * return result.data.clusters; // Auto-validated and typed
 * ```
 */
export async function executeLLM<T = unknown>(
  config: LLMExecutionConfig,
): Promise<LLMExecutionResult<T>> {
  const logger = await getLogger();

  logger.info(
    config.context,
    `Starting LLM execution (file-based): ${config.templateSlug}`,
  );

  // Define variables outside try block for catch block access
  let provider: LLMProvider | string = 'deepseek';
  let model = 'deepseek-chat';
  const startTime = Date.now();

  try {
    // 1. Load and render prompt from JSON file
    const rendered = await loadAndRenderPrompt(
      config.templateSlug,
      config.variables,
    );

    logger.info(
      {
        ...config.context,
        promptVersion: rendered.version,
        llmProvider: rendered.llmConfig.provider,
        llmModel: rendered.llmConfig.model,
      },
      'Loaded and rendered prompt from file',
    );

    // 2. Build messages array (system + user)
    // Inject schema_for_llm into system prompt if available
    let systemPromptContent = rendered.systemPrompt;

    if (rendered.output?.schema_for_llm) {
      systemPromptContent +=
        '\n\n**Expected Output Schema:**\n' + rendered.output.schema_for_llm;

      logger.info(
        {
          ...config.context,
          schemaInjected: true,
          schemaLength: rendered.output.schema_for_llm.length,
        },
        'Injected schema_for_llm into system prompt',
      );
    }

    const messages = [
      {
        role: 'system' as const,
        content: systemPromptContent,
      },
      {
        role: 'user' as const,
        content: rendered.userPrompt,
      },
    ];

    logger.info(
      {
        ...config.context,
        systemPromptLength: systemPromptContent.length,
        userPromptLength: rendered.userPrompt.length,
        schemaInjected: !!rendered.output?.schema_for_llm,
      },
      'Built messages array from rendered prompts',
    );

    // 3. Create LLM client
    provider = rendered.llmConfig.provider || 'local';
    model = rendered.llmConfig.model || 'claude-sonnet-4-5';

    const llm = createLLMClient({
      provider: provider as LLMProvider,
      model,
      apiKey: getApiKeyForProvider(provider),
    });

    // 4. Execute LLM call (use config from JSON or override)
    const resolvedMaxTokens =
      config.maxTokens ?? rendered.llmConfig.max_tokens ?? 2000;

    logger.info(
      {
        ...config.context,
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
          ...config.context,
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
        ...config.context,
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
            temperature:
              config.temperature ?? rendered.llmConfig.temperature ?? 0.5,
            maxTokens: currentMaxTokens,
          }),
        logger,
        config.context,
        {
          maxRetries: 5,
          retryDelay: 2000, // 2s, 4s, 8s, 16s, 32s with exponential backoff
          retryableErrors: [
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
          ],
        },
      );
      latency = Date.now() - startTime;

      logger.info(
        {
          ...config.context,
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

      // Log full response before extraction attempt
      const responseContent = response.message.content ?? '';
      logger.info(
        {
          ...config.context,
          responseLength: responseContent.length,
          provider,
          model,
        },
        'LLM response received - attempting JSON extraction',
      );

      // Try to extract JSON
      try {
        fullData = extractJSON<unknown>(responseContent, responseType);
        // Success - break out of retry loop
        break;
      } catch (extractionError) {
        const errorMessage =
          extractionError instanceof Error
            ? extractionError.message
            : 'Unknown error';

        // Check if this is a JSON syntax error (likely truncation)
        const isJsonSyntaxError = errorMessage.includes('Invalid JSON syntax');

        if (isJsonSyntaxError && jsonRetryAttempt < MAX_JSON_RETRIES) {
          // Escalate max_tokens and retry
          const nextMaxTokens = Math.ceil(
            currentMaxTokens * JSON_RETRY_TOKEN_MULTIPLIER,
          );

          logger.warn(
            {
              ...config.context,
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

        // Either not a JSON syntax error, or max retries exhausted
        // Log full request and response on final extraction failure
        logger.error(
          {
            ...config.context,
            // Full request context
            requestMessages: messages.map((m) => ({
              role: m.role,
              contentLength: (m.content ?? '').length,
              contentFull: m.content ?? '', // FULL content, not truncated
            })),
            requestConfig: {
              temperature:
                config.temperature ?? rendered.llmConfig.temperature ?? 0.5,
              maxTokens: currentMaxTokens,
              responseFormat: rendered.llmConfig.response_format,
            },
            // Full response context
            responseContentFull: responseContent, // FULL response
            responseLength: responseContent.length,
            provider,
            model,
            // Extraction error details
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

    // 8. Validate with Zod schema if provided and validation enabled
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
            ...config.context,
            schemaDefinition: outputConfig.schema.definition.substring(0, 100),
          },
          'Validating response with Zod schema',
        );

        const validated = schemaFn.parse(fullData);
        fullData = validated;

        logger.info({ ...config.context }, 'Schema validation passed');
      } catch (validationError) {
        logger.error(
          {
            ...config.context,
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

    // 9. Extract wrapper array if needed (after validation)
    let data: T;
    if (wrapperKey) {
      // Extract array from validated wrapper object
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

    // 10. Log analytics (success) - use admin client to bypass RLS
    const client = getSupabaseServerAdminClient();

    try {
      await logLLMUsage(client, {
        accountId: config.context.accountId,
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
          temperature:
            config.temperature ?? rendered.llmConfig.temperature ?? 0.5,
          maxTokens: resolvedMaxTokens,
          responseFormat: rendered.llmConfig.response_format,
        },
        responseMetadata: {
          finishReason: response.finishReason,
        },
      });
    } catch (analyticsError) {
      // Don't fail the LLM execution if analytics logging fails
      logger.error(
        {
          ...config.context,
          error: analyticsError,
        },
        'Failed to log LLM usage analytics',
      );
    }

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
        ...config.context,
        error: errorMessage,
        errorType: error?.constructor?.name,
      },
      `LLM execution failed: ${config.templateSlug}`,
    );

    // Log analytics (failure) - use admin client to bypass RLS
    const client = getSupabaseServerAdminClient();

    try {
      await logLLMUsage(client, {
        accountId: config.context.accountId,
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
        errorMessage: errorMessage.substring(0, 1000), // Truncate long errors
      });
    } catch (analyticsError) {
      // Don't fail further if analytics logging fails
      logger.error(
        {
          ...config.context,
          error: analyticsError,
        },
        'Failed to log LLM failure analytics',
      );
    }

    throw error;
  }
}
