/**
 * Tool Helper
 *
 * Convenience function for creating type-safe agent tools.
 */

import type { z } from 'zod';

import type { AgentTool, AgentToolAny, ToolResult } from './types';

/**
 * Creates a type-safe agent tool.
 *
 * @example
 * ```typescript
 * const greetTool = createTool({
 *   name: 'greet',
 *   description: 'Greets a person by name',
 *   parameters: z.object({ name: z.string() }),
 *   execute: async ({ name }) => ({
 *     success: true,
 *     data: `Hello, ${name}!`,
 *   }),
 * });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createTool<TParams extends z.ZodTypeAny, TResult = any>(
    definition: AgentTool<TParams, TResult>,
): AgentToolAny {
    return definition as unknown as AgentToolAny;
}

/**
 * Creates a successful tool result.
 */
export function toolSuccess<T>(data: T): ToolResult<T> {
    return { success: true, data };
}

/**
 * Creates a failed tool result.
 */
export function toolError(error: string): ToolResult<never> {
    return { success: false, error };
}
