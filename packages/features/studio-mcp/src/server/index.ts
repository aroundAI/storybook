import 'server-only';

/**
 * @kit/studio-mcp/server — the endpoint side (FILM-1904). Everything here
 * runs in the Next.js app; tool packages import the contract from
 * `@kit/studio-mcp` and register their tools through
 * `createMcpRouteHandlers({ tools })`.
 */
export { createMcpRouteHandlers, type McpRouteOptions } from './route-handler';
export {
  withMcpAuth,
  type McpAuthDeps,
  type McpAuthResult,
} from './with-mcp-auth';
export { createOwnTokenVerifier } from './own-verifier';
export {
  MCP_USER_JWT_TTL_SECONDS,
  createHs256Signer,
  createMcpJwtSigner,
  type McpJwtSigner,
  type McpUserJwtClaims,
} from './jwt';
export { createUserScopedClient } from './user-client';
export {
  PAT_PREFIX,
  bearerToken,
  generatePersonalAccessToken,
  hashToken,
  isOwnTokenShape,
} from './token';
export {
  createPersonalAccessToken,
  listMcpConnections,
  revokeMcpConnection,
  type McpConnectionRow,
  type McpConnectionSummary,
} from './personal-access-tokens';
export {
  DEFAULT_RATE_LIMITS,
  checkRateLimits,
  rateLimitsFromEnv,
  type RateLimitDecision,
  type RateLimitName,
  type RateLimits,
} from './rate-limit';
export {
  describeRequestForLog,
  recordToolCall,
  redactHeaders,
  type ToolCallRecord,
} from './audit';
export { SERVER_INFO, buildMcpServer, type ToolRuntime } from './build-server';
export { collectNodeResponse, toNodeRequest } from './node-adapter';
export {
  authorTools,
  defaultTools,
  getWorkflowGuideTool,
  readTools,
  whoamiTool,
} from './tools';
export { WORKFLOW_GUIDE_TEXT } from './tools/workflow-guide';
export {
  defaultPrompts,
  workflowGuidePrompt,
  type McpPromptDefinition,
  type McpPromptMessage,
} from './prompts';
