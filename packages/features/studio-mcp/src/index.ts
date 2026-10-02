/**
 * @kit/studio-mcp — the contract side (FILM-1904). Nothing here is
 * server-only: the types, the error contract, the scopes, `defineTool` and
 * the request context holder. The endpoint, the auth wrapper and the
 * verifiers live in `@kit/studio-mcp/server`.
 */
export {
  MCP_ERROR_CODES,
  McpToolError,
  toMcpToolError,
  type McpErrorBody,
  type McpErrorCode,
} from './errors';
export {
  MCP_SCOPES,
  McpScopeSchema,
  McpScopesSchema,
  hasScope,
  type McpScope,
} from './scopes';
export type { McpPrincipal } from './principal';
export {
  defineTool,
  isWriteTool,
  type McpToolAnnotations,
  type McpToolContext,
  type McpToolDefinition,
  type McpToolResult,
} from './registry';
export type {
  McpConnectionRecord,
  McpTokenRefusal,
  McpTokenVerification,
  McpTokenVerifier,
} from './verifier';
export {
  getMcpRequestContext,
  isMcpRequest,
  requireMcpRequestContext,
  runWithMcpRequestContext,
  type McpRequestContext,
} from './request-context';
