/**
 * Prompt Engine Types
 *
 * Core type definitions for the JSON file-based prompt engine.
 */
import type { LLMProvider } from '@kit/llm';

/**
 * Output schema configuration for prompt responses
 */
export interface PromptOutputConfig {
  /** Type of JSON response structure */
  type: 'object' | 'array';

  /** For objects wrapping arrays, the key containing the array */
  wrapper_key?: string;

  /** Zod schema definition for validation */
  schema?: {
    type: 'zod';
    definition: string;
  };

  /** Human-readable schema to optionally inject into prompt for LLM guidance */
  schema_for_llm?: string;

  /** Example output to guide LLM */
  example_output?: unknown;
}

/**
 * Prompt template structure from JSON files
 */
export interface PromptTemplate {
  slug: string;
  name: string;
  version: number;
  category: string;
  description: string;
  llm: {
    provider: string;
    model: string;
    max_tokens: number;
    temperature: number;
    response_format?: {
      type: 'json_object' | 'text';
    };
    reasoning?: string;
  };
  output?: PromptOutputConfig;
  system_prompts: Array<{
    slug: string;
    name: string;
    content: string;
    layer_type: string;
    scope: string;
    order: number;
  }>;
  user_prompt: string;
  variables: Record<
    string,
    {
      type: string;
      required: boolean;
      description?: string;
    }
  >;
  metadata?: Record<string, unknown>;
  exported_at: string;
}

/**
 * Rendered prompt ready for LLM execution
 */
export interface RenderedPrompt {
  systemPrompt: string;
  userPrompt: string;
  llmConfig: {
    provider: string;
    model: string;
    temperature: number;
    max_tokens: number;
    response_format?: {
      type: 'json_object' | 'text';
    };
  };
  output?: PromptOutputConfig;
  version: number;
  slug: string;
}

/**
 * Configuration for LLM execution
 */
export interface LLMExecutionConfig {
  /** Template slug to fetch from JSON file */
  templateSlug: string;

  /** Variables to pass to template renderer */
  variables: Record<string, unknown>;

  /** Context for logging and analytics (requires accountId) */
  context: {
    name: string;
    accountId: string;
    userId?: string;
    [key: string]: string | number | undefined;
  };

  /** Optional: Temperature for LLM (overrides template default) */
  temperature?: number;

  /** Optional: Max tokens for LLM (overrides template default) */
  maxTokens?: number;

  /** Optional: Enable schema validation (default: true if schema exists) */
  validateSchema?: boolean;
}

/**
 * Result from LLM execution
 */
export interface LLMExecutionResult<T> {
  /** Parsed and typed JSON response */
  data: T;

  /** Execution metadata */
  metadata: {
    latency: number;
    tokens: number;
    cost: number | undefined;
    provider: LLMProvider | string;
    model: string;
  };
}
