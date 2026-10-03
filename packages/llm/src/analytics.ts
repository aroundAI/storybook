/**
 * A library, not a `'use server'` module (KB-58): every export of one of
 * those is an endpoint anyone can call. No `server-only` either: the LLM
 * worker Lambda imports this, and `server-only` throws outside Next.
 */
/**
 * LLM Usage Analytics
 *
 * Simple helper to log LLM executions to database for cost monitoring
 * and failure analysis.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { LLMProvider } from './types';

/**
 * LLM Usage Event for analytics tracking
 */
export interface LLMUsageEvent {
  // Context
  accountId: string;
  userId?: string;
  /**
   * The generation run this call belongs to (FILM-1903). Required: the
   * database refuses a usage row without an open server run (part C).
   */
  runId: string;

  // Execution metadata
  /** The prompt template; absent for a call that has none, such as an embedding */
  templateSlug?: string;
  operationName: string;

  // LLM configuration
  llmProvider: LLMProvider | string;
  llmModel: string;

  // Token usage
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;

  // Cost (USD) - optional for local provider
  promptCost?: number;
  completionCost?: number;
  totalCost?: number;

  // Performance
  latencyMs: number;

  // Status
  status: 'success' | 'failure';
  errorCode?: string;
  errorMessage?: string;

  // Request/response metadata
  requestConfig?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
}

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

/**
 * Log LLM usage to database for analytics
 *
 * Non-blocking - analytics failure won't break LLM operations.
 * Logs to console on error but doesn't throw.
 *
 * @example
 * ```typescript
 * await logLLMUsage(client, {
 *   accountId: user.accountId,
 *   userId: user.id,
 *   templateSlug: 'cluster-problems-from-posts',
 *   operationName: 'cluster-problems',
 *   llmProvider: 'openai',
 *   llmModel: 'gpt-4o-mini',
 *   promptTokens: 1200,
 *   completionTokens: 450,
 *   totalTokens: 1650,
 *   totalCost: 0.000495,
 *   latencyMs: 2340,
 *   status: 'success',
 * });
 * ```
 */
export async function logLLMUsage(
  client: SupabaseClient,
  event: LLMUsageEvent,
): Promise<void> {
  try {
    // Validate UUIDs - if invalid, use null to avoid database errors
    const accountId = isValidUUID(event.accountId) ? event.accountId : null;
    const userId =
      event.userId && isValidUUID(event.userId) ? event.userId : null;

    const { error } = await client.from('llm_usage_analytics').insert({
      account_id: accountId,
      user_id: userId,
      template_slug: event.templateSlug ?? null,
      operation_name: event.operationName,
      llm_provider: event.llmProvider,
      llm_model: event.llmModel,
      prompt_tokens: event.promptTokens,
      completion_tokens: event.completionTokens,
      total_tokens: event.totalTokens,
      prompt_cost: event.promptCost,
      completion_cost: event.completionCost,
      total_cost: event.totalCost,
      latency_ms: event.latencyMs,
      status: event.status,
      error_code: event.errorCode,
      error_message: event.errorMessage,
      request_config: event.requestConfig,
      response_metadata: event.responseMetadata,
      run_id: event.runId,
    });

    if (error) {
      // Log but don't throw - analytics failure shouldn't break operations
      console.error('[LLM Analytics] Failed to log usage:', error);
    }
  } catch (error) {
    // Swallow analytics errors - don't disrupt operations
    console.error('[LLM Analytics] Error logging usage:', error);
  }
}
