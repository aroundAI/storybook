import type { McpScope } from './scopes';

/**
 * A connection as the settings page shows it: no hash, no token. Shared by
 * the server reads and the client components, so it lives outside
 * `server/`.
 */
export interface McpConnectionSummary {
  id: string;
  kind: 'oauth' | 'pat';
  /** The OAuth client; null for a personal access token. */
  clientId: string | null;
  /** The device, for a desktop client (FILM-2005); else the client's name. */
  name: string;
  scopes: McpScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}
