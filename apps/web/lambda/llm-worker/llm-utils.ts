/**
 * Lambda-compatible LLM utilities
 *
 * These functions are extracted from @kit/prompt-engine/server but modified
 * to work in Lambda environment (no Next.js server-only dependencies).
 */
import type { LLMProvider } from '@kit/llm';
import { createLLMClient } from '@kit/llm';
import { renderTemplate } from '@kit/prompt-engine/render-template';

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
 * Execute LLM call with prompt template
 * Lambda-compatible version
 */
export async function executeLLMForLambda<T = unknown>(config: {
  templateSlug: string;
  variables: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
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
  const provider = rendered.llmConfig.provider || 'deepseek';
  const model = rendered.llmConfig.model || 'deepseek-chat';
  const apiKey = getApiKeyForProvider(provider);

  if (!apiKey) {
    throw new Error(`No API key found for provider: ${provider}`);
  }

  console.log(`[LLM Lambda] Creating client: ${provider}/${model}`);

  const llm = createLLMClient({
    provider: provider as LLMProvider,
    model,
    apiKey,
    vertexai: provider === 'gemini' && process.env.GEMINI_VERTEXAI === 'true',
    project: process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.GOOGLE_CLOUD_LOCATION,
  });

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

  return {
    data,
    metadata: {
      tokens: response.usage.totalTokens,
      latency,
      provider,
      model,
    },
  };
}
