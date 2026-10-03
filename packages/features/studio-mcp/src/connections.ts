import type { McpScope } from './scopes';

/**
 * A connection as the settings page shows it: no hash, no token. Shared by
 * the server reads and the client components, so it lives outside
 * `server/`.
 */
export interface McpConnectionSummary {
  id: string;
  kind: 'oauth' | 'pat';
  name: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
