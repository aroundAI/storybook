/**
 * Agent Runner
 *
 * The core agent execution loop. Uses `createLLMClient` from @kit/llm
 * to implement a tool-calling loop where:
 *
 * 1. Tool definitions are injected into the system prompt
 * 2. LLM responds with structured JSON (tool_call or final_answer)
 * 3. Runner parses, dispatches tools, feeds results back
 * 4. Loop continues until final_answer or budget/step limit hit
 *
 * This is vendor-independent — works with any LLM provider supported by @kit/llm.
 */
import { createLLMClient, forcedLocalConfig } from '@kit/llm';
import type { LLMProvider } from '@kit/llm';

import { BudgetExceededError, createBudgetTracker } from './budget';
import { applySkills } from './skills';
import type {
  AgentConfig,
  AgentMessage,
  AgentRunContext,
  AgentRunResult,
  AgentStep,
  AgentTool,
  ParsedAgentResponse,
} from './types';

// =============================================================================
// PROMPT BUILDING
// =============================================================================

/**
 * Builds the system prompt with tool definitions injected.
 * The LLM sees this and knows which tools are available.
 */
function buildSystemPromptWithTools(
  basePrompt: string,
  tools: AgentTool[],
): string {
  if (tools.length === 0) return basePrompt;

  const toolDocs = tools
    .map((tool) => {
      // Extract parameter schema info for the LLM
      const schemaDescription = describeZodSchema(tool.parameters);
      return `- **${tool.name}**: ${tool.description}\n  Parameters: ${schemaDescription}`;
    })
    .join('\n');

  return `${basePrompt}

# Available Tools

You have access to the following tools. To use a tool, respond with a JSON object.

${toolDocs}

# Response Format

You MUST respond with valid JSON in one of these two formats:

**To call a tool:**
\`\`\`json
{
  "action": "tool_call",
  "tool": "<tool_name>",
  "params": { ... },
  "reasoning": "<brief explanation of why you're calling this tool>"
}
\`\`\`

**To provide the final answer:**
\`\`\`json
{
  "action": "final_answer",
  "result": { ... },
  "reasoning": "<brief explanation of your final answer>"
}
\`\`\`

IMPORTANT: Always respond with ONLY the JSON object. Do not include any text before or after the JSON.`;
}

/**
 * Extracts a human-readable description of a Zod schema.
 * Used to describe tool parameters to the LLM.
 */
function describeZodSchema(schema: unknown): string {
  try {
    // Try to get the zod schema description
    const s = schema as {
      _def?: {
        typeName?: string;
        shape?: () => Record<string, unknown>;
        description?: string;
      };
    };

    if (s._def?.typeName === 'ZodObject' && s._def.shape) {
      const shape = s._def.shape();
      const fields = Object.entries(shape).map(([key, value]) => {
        const v = value as {
          _def?: { typeName?: string; description?: string };
          isOptional?: () => boolean;
        };
        const optional = v._def?.typeName === 'ZodOptional' ? '?' : '';
        const desc = v._def?.description ? ` — ${v._def.description}` : '';
        return `${key}${optional}${desc}`;
      });
      return `{ ${fields.join(', ')} }`;
    }

    return '(see tool description)';
  } catch {
    return '(see tool description)';
  }
}

// =============================================================================
// RESPONSE PARSING
// =============================================================================

/**
 * Parses the LLM's response to determine if it's a tool call or final answer.
 */
function parseAgentResponse(content: string | null): ParsedAgentResponse {
  if (!content) {
    throw new AgentParseError('Empty response from LLM');
  }

  // Strip markdown code fences if present.
  // IMPORTANT: Anchored with ^ and $ so we only match when the ENTIRE response
  // is wrapped in fences. Without anchors, backticks inside JSON string values
  // (e.g. user-entered dialogue hints) would cause incorrect extraction.
  let cleaned = content.trim();
  const jsonMatch = cleaned.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (jsonMatch?.[1]) {
    cleaned = jsonMatch[1].trim();
  }

  // Try to find JSON object
  const startIdx = cleaned.indexOf('{');
  if (startIdx === -1) {
    throw new AgentParseError(
      `No JSON object found in LLM response: ${content.substring(0, 200)}`,
    );
  }

  // Find balanced JSON
  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = startIdx; i < cleaned.length; i++) {
    const char = cleaned[i]!;

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
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          const jsonStr = cleaned.substring(startIdx, i + 1);

          try {
            const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

            if (parsed.action === 'tool_call') {
              return {
                type: 'tool_call',
                toolName: parsed.tool as string,
                params: (parsed.params as Record<string, unknown>) ?? {},
              };
            }

            if (parsed.action === 'final_answer') {
              return {
                type: 'final_answer',
                result: parsed.result,
              };
            }

            throw new AgentParseError(
              `Unknown action type: ${parsed.action as string}`,
            );
          } catch (e) {
            if (e instanceof AgentParseError) throw e;
            throw new AgentParseError(
              `Invalid JSON in LLM response: ${(e as Error).message}`,
            );
          }
        }
      }
    }
  }

  throw new AgentParseError('Unbalanced JSON in LLM response');
}

/**
 * Error thrown when the agent cannot parse the LLM's response.
 */
export class AgentParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentParseError';
  }
}

// =============================================================================
// API KEY RESOLUTION
// =============================================================================

/**
 * Resolves API key for the given provider from environment variables.
 */
function getApiKeyForProvider(provider: string): string {
  switch (provider) {
    case 'openai':
      return process.env.OPENAI_API_KEY ?? '';
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY ?? '';
    case 'gemini':
      return process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY ?? '';
    case 'local':
      return 'not-needed';
    default:
      return '';
  }
}

// =============================================================================
// RETRY HELPER
// =============================================================================

/**
 * Retryable error patterns — matches the list used by executeLLM in
 * @kit/prompt-engine for consistency across the pipeline.
 */
const RETRYABLE_ERRORS = [
  'UNAVAILABLE',
  'high demand',
  '503',
  '429',
  'overloaded',
  'Resource has been exhausted',
  'ECONNRESET',
  'ETIMEDOUT',
  'fetch failed',
  'socket hang up',
];

const MAX_LLM_RETRIES = 4;
const BASE_RETRY_DELAY_MS = 3000;

/**
 * Retry wrapper for transient LLM errors with exponential backoff.
 * Delays: 3s → 6s → 12s → 24s → 48s (~93s total).
 * Handles Google 503 capacity spikes which can persist for 30-60s.
 * Non-retryable errors fail immediately.
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  agentName: string,
  stepNumber: number,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_LLM_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      const errMsg = lastError.message ?? String(error);

      const isRetryable = RETRYABLE_ERRORS.some((code) =>
        errMsg.includes(code),
      );

      if (!isRetryable || attempt === MAX_LLM_RETRIES) {
        throw error;
      }

      const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[Agent:${agentName}] Step ${stepNumber} — Transient LLM error ` +
          `(attempt ${attempt + 1}/${MAX_LLM_RETRIES + 1}). ` +
          `Retrying in ${delay}ms: ${errMsg.substring(0, 200)}`,
      );

      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError!;
}

// =============================================================================
// RUNNER
// =============================================================================

/**
 * Runs an agent with the given configuration and input.
 *
 * The agent iterates through a tool-calling loop:
 * 1. Send conversation to LLM with tool definitions in system prompt
 * 2. Parse response as tool_call or final_answer
 * 3. If tool_call: execute tool, add result to conversation, continue
 * 4. If final_answer: return result
 * 5. Stop if maxSteps or budget limits are exceeded
 *
 * @example
 * ```typescript
 * const result = await runAgent<StoryOutput>({
 *   name: 'story-generator',
 *   systemPrompt: 'Generate a high-quality story...',
 *   tools: [generateStoryTool, evaluateQualityTool],
 *   maxSteps: 6,
 *   budgetLimits: { maxTotalTokens: 50000, maxCostUSD: 0.50, maxLatencyMs: 120000 },
 * }, {
 *   userPrompt: 'Write a story about...',
 * });
 * ```
 */
export async function runAgent<T = unknown>(
  config: AgentConfig,
  input: { userPrompt: string; context?: Record<string, unknown> },
  runContext: AgentRunContext,
): Promise<AgentRunResult<T>> {
  // Apply skills to merge tools and context into config
  const resolved = config.skills?.length
    ? applySkills(config, config.skills)
    : config;

  const budget = createBudgetTracker(resolved.budgetLimits);
  const steps: AgentStep[] = [];
  const conversationHistory: AgentMessage[] = [];
  const runStartTime = Date.now();

  // Build system prompt with tool definitions
  const systemPrompt = buildSystemPromptWithTools(
    resolved.systemPrompt,
    resolved.tools,
  );

  // Create LLM client
  const forcedLocal = forcedLocalConfig();
  const provider = (forcedLocal?.provider ??
    resolved.provider ??
    'gemini') as LLMProvider;
  const model = forcedLocal?.model ?? resolved.model ?? 'gemini-3.1-flash-lite';

  console.log(
    `[Agent:${config.name}] Starting. Provider: ${provider}, Model: ${model}, ` +
      `MaxSteps: ${resolved.maxSteps}, Tools: [${resolved.tools.map((t) => t.name).join(', ')}], ` +
      `SystemPrompt: ${systemPrompt.length} chars, UserPrompt: ${input.userPrompt.length} chars`,
  );

  const llm = createLLMClient(
    forcedLocal ?? {
      provider,
      model,
      apiKey: getApiKeyForProvider(provider),
      baseUrl: provider === 'local' ? process.env.LOCAL_API_URL : undefined,
      vertexai: provider === 'gemini' && process.env.GEMINI_VERTEXAI === 'true',
      project: process.env.GOOGLE_CLOUD_PROJECT,
      location: process.env.GOOGLE_CLOUD_LOCATION,
    },
  );

  // Start conversation
  conversationHistory.push({ role: 'user', content: input.userPrompt });

  for (let stepIdx = 0; stepIdx < resolved.maxSteps; stepIdx++) {
    const stepStartTime = Date.now();

    // OPT-4: Pre-step budget check — estimate if the next step would
    // exceed the token budget. Uses a rough estimate based on current
    // conversation history size + expected output tokens.
    const estimatedInputTokens = Math.ceil(
      (systemPrompt.length +
        conversationHistory.reduce((sum, m) => sum + m.content.length, 0)) /
        4,
    );
    const estimatedStepTokens =
      estimatedInputTokens + (resolved.maxTokensPerStep ?? 4000);

    if (budget.wouldExceed(estimatedStepTokens)) {
      console.warn(
        `[Agent:${config.name}] Step ${stepIdx + 1} — Pre-step budget check: ` +
          `estimated ${estimatedStepTokens} tokens would exceed remaining ` +
          `${budget.remainingTokens()} tokens. Terminating early.`,
      );

      // Return the last successful tool result as the final answer
      const lastToolStep = steps.findLast(
        (s) => s.type === 'tool_call' && s.toolResult?.success,
      );
      if (lastToolStep?.toolResult?.data) {
        return {
          success: true,
          data: lastToolStep.toolResult.data as T,
          budget: budget.getState(),
          steps,
          error: 'Early termination: budget would be exceeded by next step',
        };
      }

      return {
        success: false,
        error: `Budget would be exceeded: estimated ${estimatedStepTokens} tokens, remaining ${budget.remainingTokens()}`,
        budget: budget.getState(),
        steps,
      };
    }

    console.log(
      `[Agent:${config.name}] Step ${stepIdx + 1}/${resolved.maxSteps} — ` +
        `calling LLM with ${conversationHistory.length} messages ` +
        `(~${estimatedInputTokens} estimated input tokens, ` +
        `${budget.remainingTokens()} remaining budget)`,
    );

    try {
      // 1. Call LLM with retry for transient capacity errors (503, 429)
      // Matches the retry behavior in executeLLM (prompt-engine) which
      // successfully handles 503 spikes for skill/tool LLM calls.
      const response = await executeWithRetry(
        () =>
          llm.createChatCompletion({
            messages: [
              { role: 'system', content: systemPrompt },
              ...conversationHistory,
            ],
            temperature: resolved.temperature ?? 0.3,
            maxTokens: resolved.maxTokensPerStep ?? 4000,
          }),
        config.name,
        stepIdx + 1,
      );

      const stepLatency = Date.now() - stepStartTime;
      const tokens = response.usage.totalTokens;
      const cost = response.cost?.total ?? 0;

      console.log(
        `[Agent:${config.name}] Step ${stepIdx + 1} — LLM responded in ${stepLatency}ms, ` +
          `tokens: ${tokens}, cost: $${cost.toFixed(4)}`,
      );

      // 2. Track budget
      budget.record(tokens, cost, stepLatency);

      // 3. Check budget
      const budgetCheck = budget.isExceeded();
      if (budgetCheck.exceeded) {
        console.error(
          `[Agent:${config.name}] Budget exceeded at step ${stepIdx + 1}: ${budgetCheck.reason}`,
        );
        return {
          success: false,
          error: budgetCheck.reason,
          budget: budget.getState(),
          steps,
        };
      }

      // 4. Parse response
      const responseContent = response.message.content ?? '';

      // Log a preview of the raw LLM response (first 500 chars)
      console.log(
        `[Agent:${config.name}] Step ${stepIdx + 1} — Raw LLM response (${responseContent.length} chars): ` +
          `${responseContent.substring(0, 500)}${responseContent.length > 500 ? '...' : ''}`,
      );

      let parsed: ParsedAgentResponse;

      try {
        parsed = parseAgentResponse(responseContent);
      } catch (parseError) {
        // If parsing fails, treat the raw response as a final answer
        // This handles cases where the LLM doesn't follow the format
        console.warn(
          `[Agent:${config.name}] Step ${stepIdx + 1} — PARSE FAILED: ${(parseError as Error).message}. ` +
            `Treating raw response as final_answer.`,
        );

        steps.push({
          type: 'final_answer',
          content: responseContent,
          tokensUsed: tokens,
          costUSD: cost,
          latencyMs: stepLatency,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          data: responseContent as T,
          budget: budget.getState(),
          steps,
          error: `Parse warning: ${(parseError as Error).message}`,
        };
      }

      console.log(
        `[Agent:${config.name}] Step ${stepIdx + 1} — Parsed action: ${parsed.type}` +
          `${parsed.type === 'tool_call' ? ` → tool: ${parsed.toolName}` : ''}`,
      );

      // 5. Handle based on action type
      if (parsed.type === 'tool_call') {
        // Find the tool
        const tool = resolved.tools.find((t) => t.name === parsed.toolName);
        if (!tool) {
          // Unknown tool — tell the LLM and continue
          conversationHistory.push(
            { role: 'assistant', content: responseContent },
            {
              role: 'user',
              content: `Error: Unknown tool "${parsed.toolName}". Available tools: ${resolved.tools.map((t) => t.name).join(', ')}`,
            },
          );

          steps.push({
            type: 'tool_call',
            toolName: parsed.toolName,
            toolParams: parsed.params,
            toolResult: {
              success: false,
              error: `Unknown tool: ${parsed.toolName}`,
            },
            tokensUsed: tokens,
            costUSD: cost,
            latencyMs: stepLatency,
            timestamp: new Date().toISOString(),
          });

          continue;
        }

        // Execute the tool
        console.log(
          `[Agent:${config.name}] Step ${stepIdx + 1} — Executing tool: ${parsed.toolName}`,
        );

        let toolResult;
        try {
          // Validate params with zod schema
          const validatedParams = tool.parameters.parse(parsed.params);
          toolResult = await tool.execute(validatedParams, runContext);

          console.log(
            `[Agent:${config.name}] Step ${stepIdx + 1} — Tool ${parsed.toolName} completed. ` +
              `Success: ${toolResult?.success ?? 'unknown'}`,
          );
        } catch (toolError) {
          const errMsg =
            toolError instanceof Error
              ? toolError.message
              : 'Tool execution failed';
          console.error(
            `[Agent:${config.name}] Step ${stepIdx + 1} — Tool ${parsed.toolName} THREW: ${errMsg}`,
          );
          toolResult = {
            success: false,
            error: errMsg,
          };
        }

        // Record step
        steps.push({
          type: 'tool_call',
          toolName: parsed.toolName,
          toolParams: parsed.params,
          toolResult,
          tokensUsed: tokens,
          costUSD: cost,
          latencyMs: stepLatency,
          timestamp: new Date().toISOString(),
        });

        // Add to conversation history for next iteration
        // OPT-2: Use summarizeResult when available to reduce history token growth.
        // The full result is preserved in the step trace (above) for debugging.
        const historyResult =
          tool.summarizeResult && toolResult?.success
            ? tool.summarizeResult(toolResult)
            : toolResult;

        // OPT-1: Use compact JSON (no pretty-printing) to save ~15% tokens
        conversationHistory.push(
          { role: 'assistant', content: responseContent },
          {
            role: 'user',
            content: `Tool "${parsed.toolName}" returned:\n${JSON.stringify(historyResult)}`,
          },
        );
      } else {
        // Final answer — we're done
        console.log(
          `[Agent:${config.name}] Step ${stepIdx + 1} — FINAL ANSWER received. ` +
            `Result preview: ${JSON.stringify(parsed.result).substring(0, 300)}`,
        );

        steps.push({
          type: 'final_answer',
          content: parsed.result,
          tokensUsed: tokens,
          costUSD: cost,
          latencyMs: stepLatency,
          timestamp: new Date().toISOString(),
        });

        return {
          success: true,
          data: parsed.result as T,
          budget: budget.getState(),
          steps,
        };
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        console.error(
          `[Agent:${config.name}] BudgetExceededError at step ${stepIdx + 1}: ${error.message}`,
        );
        return {
          success: false,
          error: error.message,
          budget: budget.getState(),
          steps,
        };
      }

      // LLM call failed — record and abort
      console.error(
        `[Agent:${config.name}] Step ${stepIdx + 1} — LLM CALL FAILED: ${(error as Error).message}`,
      );

      steps.push({
        type: 'tool_call',
        content: `LLM call failed: ${(error as Error).message}`,
        tokensUsed: 0,
        costUSD: 0,
        latencyMs: Date.now() - stepStartTime,
        timestamp: new Date().toISOString(),
      });

      return {
        success: false,
        error: (error as Error).message,
        budget: budget.getState(),
        steps,
      };
    }
  }

  // Max steps exceeded
  const totalLatency = Date.now() - runStartTime;
  return {
    success: false,
    error: `Max steps (${resolved.maxSteps}) exceeded without reaching a final answer. Total latency: ${totalLatency}ms`,
    budget: budget.getState(),
    steps,
  };
}
