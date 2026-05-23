/**
 * @kit/agent - Core Type Definitions
 *
 * Defines the agent runtime's type system: tools, skills, configs,
 * budget tracking, and execution results.
 */
import type { z } from 'zod';

import type { ChatMessage, LLMProvider } from '@kit/llm';

// =============================================================================
// TOOL TYPES
// =============================================================================

/**
 * Execution context provided to tools during an agent run.
 * Ensures multi-tenant isolation and correct analytics tracking.
 */
export interface AgentRunContext {
  accountId: string;
  userId?: string;
}

/**
 * A tool the agent can invoke during execution.
 * Tools are the primary mechanism for agents to interact with external systems.
 */
export interface AgentTool<
  TParams extends z.ZodTypeAny = z.ZodTypeAny,
  TResult = unknown,
> {
  /** Unique name for this tool */
  name: string;
  /** Description the LLM reads to decide when to use this tool */
  description: string;
  /** Zod schema defining expected parameters */
  parameters: TParams;
  /** Function that executes the tool's logic */
  execute: (
    params: z.infer<TParams>,
    context: AgentRunContext,
  ) => Promise<ToolResult<TResult>>;
  /**
   * Optional function to produce a compact summary of the tool result
   * for the agent's conversation history. When provided, the runner stores
   * the summary instead of the full result, significantly reducing token
   * usage on subsequent LLM calls.
   *
   * The full result is still recorded in the step trace for debugging.
   */
  summarizeResult?: (result: ToolResult<TResult>) => unknown;
}

/**
 * An AgentTool with all generics erased — used for storing heterogeneous
 * tools in arrays (AgentConfig.tools, Skill.tools) without variance errors.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentToolAny = AgentTool<z.ZodTypeAny, any>;

/**
 * Result from executing a tool.
 */
export interface ToolResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// =============================================================================
// SKILL TYPES
// =============================================================================

/**
 * A Skill is a composable bundle of tools + context + instructions.
 *
 * Skills encapsulate domain-specific capabilities that can be attached
 * to any agent. They provide:
 * - Tools: Functions the agent can call
 * - Context: Domain knowledge injected into the system prompt
 * - Instructions: Step-by-step guidance for the agent
 */
export interface Skill {
  /** Unique name for this skill */
  name: string;
  /** Description of what this skill enables */
  description: string;
  /** Tools this skill provides */
  tools: AgentToolAny[];
  /** Domain context appended to system prompt when skill is active */
  contextPrompt?: string;
  /** Step-by-step instructions for using this skill's tools */
  instructions?: string;
}

// =============================================================================
// BUDGET TYPES
// =============================================================================

/**
 * Budget limits for an agent run.
 * Any limit being exceeded will stop the agent's execution loop.
 */
export interface BudgetLimits {
  /** Maximum total tokens (input + output) across all steps */
  maxTotalTokens: number;
  /** Maximum total cost in USD across all steps */
  maxCostUSD: number;
  /** Maximum wall-clock time in milliseconds */
  maxLatencyMs: number;
}

/**
 * Current budget consumption state.
 */
export interface BudgetState {
  totalTokens: number;
  totalCostUSD: number;
  totalLatencyMs: number;
  stepCount: number;
}

/**
 * Result of a budget check.
 */
export interface BudgetCheckResult {
  exceeded: boolean;
  reason?: string;
}

// =============================================================================
// AGENT CONFIG
// =============================================================================

/**
 * Configuration for an agent run.
 */
export interface AgentConfig {
  /** Human-readable name for this agent (used in logs/analytics) */
  name: string;
  /** Base system prompt — tool definitions are appended automatically */
  systemPrompt: string;
  /** Tools available to the agent */
  tools: AgentToolAny[];
  /** Optional skills that bundle tools + context */
  skills?: Skill[];
  /** Maximum number of LLM↔tool round-trips before stopping */
  maxSteps: number;
  /** Budget limits for cost/token/time control */
  budgetLimits: BudgetLimits;
  /** LLM provider override (defaults to env config) */
  provider?: LLMProvider | string;
  /** LLM model override (defaults to env config) */
  model?: string;
  /** Temperature override for the agent's LLM calls */
  temperature?: number;
  /** Max tokens per individual LLM call */
  maxTokensPerStep?: number;
}

// =============================================================================
// EXECUTION RESULT TYPES
// =============================================================================

/**
 * A single step in the agent's execution trace.
 */
export interface AgentStep {
  type: 'tool_call' | 'final_answer';
  /** Tool name (when type is 'tool_call') */
  toolName?: string;
  /** Parameters passed to the tool */
  toolParams?: unknown;
  /** Result returned by the tool */
  toolResult?: ToolResult;
  /** Final answer content (when type is 'final_answer') */
  content?: unknown;
  /** Tokens used in this step's LLM call */
  tokensUsed: number;
  /** Cost of this step in USD */
  costUSD: number;
  /** Latency of this step in milliseconds */
  latencyMs: number;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * Full result of an agent run.
 */
export interface AgentRunResult<T = unknown> {
  success: boolean;
  data?: T;
  budget: BudgetState;
  steps: AgentStep[];
  error?: string;
}

// =============================================================================
// INTERNAL TYPES (used by runner)
// =============================================================================

/**
 * Parsed response from the LLM — either a tool call or a final answer.
 */
export type ParsedAgentResponse =
  | {
      type: 'tool_call';
      toolName: string;
      params: Record<string, unknown>;
    }
  | {
      type: 'final_answer';
      result: unknown;
    };

/**
 * Conversation message used internally by the runner.
 */
export type AgentMessage = ChatMessage;
