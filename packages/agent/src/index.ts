/**
 * @kit/agent - Agentic AI Runtime
 *
 * Provides a tool-calling agent loop with skills, memory, and budget tracking.
 * Built on @kit/llm — vendor-independent, works with all supported providers.
 *
 * @example
 * ```typescript
 * import { runAgent, createTool, createSkill } from '@kit/agent';
 * import { z } from 'zod';
 *
 * const myTool = createTool({
 *   name: 'search',
 *   description: 'Search for information',
 *   parameters: z.object({ query: z.string() }),
 *   execute: async ({ query }) => ({ success: true, data: `Results for: ${query}` }),
 * });
 *
 * const result = await runAgent({
 *   name: 'my-agent',
 *   systemPrompt: 'You are a helpful assistant.',
 *   tools: [myTool],
 *   maxSteps: 5,
 *   budgetLimits: { maxTotalTokens: 10000, maxCostUSD: 0.10, maxLatencyMs: 30000 },
 * }, {
 *   userPrompt: 'Find information about TypeScript agents',
 * }, {
 *   accountId: account.id,
 * });
 * ```
 */

// Runner
export { runAgent } from './runner';
export { AgentParseError } from './runner';

// Budget
export { createBudgetTracker, BudgetExceededError } from './budget';
export type { BudgetTracker } from './budget';

// Skills
export { applySkills, createSkill } from './skills';

// Tool helper
export { createTool, toolSuccess, toolError } from './tool';

// Types
export type {
  AgentTool,
  AgentToolAny,
  ToolResult,
  Skill,
  BudgetLimits,
  BudgetState,
  BudgetCheckResult,
  AgentConfig,
  AgentStep,
  AgentRunResult,
  ParsedAgentResponse,
  AgentMessage,
} from './types';
