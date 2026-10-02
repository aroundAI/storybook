/**
 * Lambda-compatible LLM utilities
 *
 * These functions are extracted from @kit/prompt-engine/server but modified
 * to work in Lambda environment (no Next.js server-only dependencies).
 */
import type { LLMProvider, LLMUsageEvent } from '@kit/llm';
import {
  LLMError,
  createLLMClient,
  forcedLocalConfig,
  logLLMUsage,
} from '@kit/llm';
import {
  assertPromptLlm,
  renderTemplate,
} from '@kit/prompt-engine/render-template';
import { createLambdaAdminClient } from '@kit/supabase/lambda-admin-client';

import { type PromptTemplate, getPromptTemplate } from './prompt-registry';

type PromptLLMConfig = PromptTemplate['llm'];

type PromptOutputConfig = NonNullable<PromptTemplate['output']>;

interface RenderedPrompt {
  templateSlug: string;
  version: string;
  systemPrompt: string;
  userPrompt: string;
  llmConfig: PromptLLMConfig;
  output?: PromptOutputConfig;
}

/**
 * Load prompt template from embedded registry
 * Lambda-compatible version (no file system access)
 */
export function loadPromptTemplate(slug: string): PromptTemplate {
  return getPromptTemplate(slug);
}

/**
 * Render prompt template with variables
 * Handles both legacy format (system_prompt string) and new format (system_prompts array)
 */
export function renderPrompt(
  template: PromptTemplate,
  variables: Record<string, unknown>,
): RenderedPrompt {
  // The same renderer prompt-engine uses (KB-126): an unfilled or
  // undeclared placeholder is an error, not blanked out of the text
  assertPromptLlm(template.slug || template.name || 'unknown', template);

  const { systemPrompt, userPrompt } = renderTemplate(
    template.slug || template.name || 'unknown',
    template,
    variables,
  );

  return {
    templateSlug: template.name || template.slug || 'unknown',
    version: String(template.version || '1'),
    systemPrompt,
    userPrompt,
    llmConfig: template.llm,
    output: template.output,
  };
}

/**
 * Load and render prompt in one step
 */
export function loadAndRenderPromptForLambda(
  slug: string,
  variables: Record<string, unknown>,
): RenderedPrompt {
  const template = loadPromptTemplate(slug);
  return renderPrompt(template, variables);
}

/**
 * Get API key for LLM provider
 */
export function getApiKeyForProvider(provider: LLMProvider | string): string {
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
 * Finds balanced JSON by counting braces/brackets
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

  return null;
}

/**
 * Extract JSON from LLM response
 */
export function extractJSON<T = unknown>(
  content: string,
  type: 'array' | 'object',
): T {
  let cleaned = content.trim();
  const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) {
    cleaned = jsonMatch[1]!.trim();
  }

  // Remove DeepSeek Reasoner <think> blocks
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/g, '').trim();

  // Try balanced brace counting
  let jsonString = findBalancedJSON(cleaned, type);

  // Fall back to greedy regex
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

  try {
    const parsed = JSON.parse(jsonString.trim());
    const actualType = Array.isArray(parsed) ? 'array' : 'object';
    if (actualType !== type) {
      throw new Error(`Expected ${type} but got ${actualType} in LLM response`);
    }
    return parsed as T;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Invalid JSON syntax in LLM response: ${error.message}. Content: ${jsonString.substring(0, 200)}...`,
      );
    }
    throw error;
  }
}

/**
 * Write one llm_usage_analytics row as the service role (KB-52), the way
 * executeLLM does. Never throws: a missing row is reported, not a failed job.
 */
async function recordUsage(event: LLMUsageEvent) {
  try {
    const client = createLambdaAdminClient();

    if (!client) {
      throw new Error('Service-role client unavailable');
    }

    await logLLMUsage(client, event);
  } catch (error) {
    console.error('[LLM Lambda] Failed to log LLM usage analytics:', error);
  }
}

/**
 * Execute LLM call with prompt template
 * Lambda-compatible version
 *
 * Every call writes llm_usage_analytics (FILM-1902): on success with the
 * response's tokens and cost, on failure with the error. Handlers pass the
 * job's `accountId` and `userId` so the row is charged to the right account;
 * `runId` is the generation run (FILM-1903) once the worker is handed one.
 */
export async function executeLLMForLambda<T = unknown>(config: {
  templateSlug: string;
  variables: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
  accountId?: string;
  userId?: string;
  /** Defaults to the template slug */
  operationName?: string;
  runId?: string;
}): Promise<{
  data: T;
  metadata: {
    tokens: number;
    latency: number;
    provider: string;
    model: string;
  };
}> {
  const startTime = Date.now();
  const usage = {
    accountId: config.accountId ?? '',
    userId: config.userId,
    runId: config.runId,
    templateSlug: config.templateSlug,
    operationName: config.operationName ?? config.templateSlug,
  };
  // Known once the prompt is rendered; the failure row carries the last value
  let provider: string = 'unknown';
  let model = 'unknown';

  try {
    // 1. Load and render prompt
    const rendered = await loadAndRenderPromptForLambda(
      config.templateSlug,
      config.variables,
    );

    console.log(
      `[LLM Lambda] Loaded prompt: ${config.templateSlug} v${rendered.version}`,
    );

    // 2. Build messages
    let systemPromptContent = rendered.systemPrompt;
    if (rendered.output?.schema_for_llm) {
      systemPromptContent +=
        '\n\n**Expected Output Schema:**\n' + rendered.output.schema_for_llm;
    }

    const messages = [
      { role: 'system' as const, content: systemPromptContent },
      { role: 'user' as const, content: rendered.userPrompt },
    ];

    // 3. Create LLM client
    const forcedLocal = forcedLocalConfig();
    provider = forcedLocal?.provider ?? rendered.llmConfig.provider;
    model = forcedLocal?.model ?? rendered.llmConfig.model;
    const apiKey = forcedLocal?.apiKey ?? getApiKeyForProvider(provider);

    if (!apiKey) {
      throw new Error(`No API key found for provider: ${provider}`);
    }

    console.log(`[LLM Lambda] Creating client: ${provider}/${model}`);

    const llm = createLLMClient(
      forcedLocal ?? {
        provider: provider as LLMProvider,
        model,
        apiKey,
        baseUrl: provider === 'local' ? process.env.LOCAL_API_URL : undefined,
        vertexai:
          provider === 'gemini' && process.env.GEMINI_VERTEXAI === 'true',
        project: process.env.GOOGLE_CLOUD_PROJECT,
        location: process.env.GOOGLE_CLOUD_LOCATION,
      },
    );

    // 4. Execute LLM call
    const maxTokens = config.maxTokens ?? rendered.llmConfig.max_tokens ?? 4000;
    const temperature =
      config.temperature ?? rendered.llmConfig.temperature ?? 0.5;

    console.log(
      `[LLM Lambda] Executing with maxTokens=${maxTokens}, temperature=${temperature}`,
    );

    const response = await llm.createChatCompletion({
      messages,
      temperature,
      maxTokens,
    });

    const latency = Date.now() - startTime;
    console.log(
      `[LLM Lambda] Got response in ${latency}ms, tokens=${response.usage.totalTokens}`,
    );

    // 5. Extract and return data
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

    // 6. Log the call (success)
    await recordUsage({
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
    await recordUsage({
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
