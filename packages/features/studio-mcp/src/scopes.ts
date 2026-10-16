import { z } from 'zod';

/**
 * What a connection may do (EDD "Auth model"). `studio:read` covers the read
 * and analytics tools, `studio:write` the author, generation and edit tools,
 * `studio:render` the vendor renders that cost money, `studio:publish`
 * scheduling publishes to the team's channels (owner, 2026-10-10).
 */
export const McpScopeSchema = z.enum([
  'studio:read',
  'studio:write',
  'studio:render',
  'studio:publish',
]);

export type McpScope = z.infer<typeof McpScopeSchema>;

export const MCP_SCOPES = McpScopeSchema.options;

/**
 * Scopes a person ticks themselves: offered on the consent screen, never
 * ticked for them, since what they allow reaches outside StoryBook.
 */
export const OPT_IN_SCOPES: readonly McpScope[] = ['studio:publish'];

/** The requested scopes the consent screen ticks before the person acts */
export function preselectedScopes(requested: readonly McpScope[]) {
  return requested.filter((scope) => !OPT_IN_SCOPES.includes(scope));
}

export const McpScopesSchema = z
  .array(McpScopeSchema)
  .min(1, 'Choose at least one scope')
  .transform((scopes) => Array.from(new Set(scopes)));

export function hasScope(granted: readonly McpScope[], needed: McpScope) {
  return granted.includes(needed);
}
