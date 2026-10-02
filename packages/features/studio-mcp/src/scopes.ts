import { z } from 'zod';

/**
 * What a connection may do (EDD "Auth model"). `studio:read` covers the read
 * and analytics tools, `studio:write` the author, generation and edit tools,
 * `studio:render` the vendor renders that cost money.
 */
export const McpScopeSchema = z.enum([
  'studio:read',
  'studio:write',
  'studio:render',
]);

export type McpScope = z.infer<typeof McpScopeSchema>;

export const MCP_SCOPES = McpScopeSchema.options;

export const McpScopesSchema = z
  .array(McpScopeSchema)
  .min(1, 'Choose at least one scope')
  .transform((scopes) => Array.from(new Set(scopes)));

export function hasScope(granted: readonly McpScope[], needed: McpScope) {
  return granted.includes(needed);
}
