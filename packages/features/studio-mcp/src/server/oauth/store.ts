import type { McpScope } from '../../scopes';

/**
 * What the authorization server keeps, behind one interface so the grant
 * logic is tested against an in-memory store and runs against Supabase
 * (`supabase-store.ts`). Every credential is stored as a SHA-256 hash; the
 * store never sees a plaintext code or token.
 */
export interface OAuthClientRecord {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  /** Set when the client is described by a metadata document at this URL. */
  metadataUrl: string | null;
  createdAt: string;
}

export interface AuthorizationCodeRecord {
  codeHash: string;
  clientId: string;
  userId: string;
  accountId: string;
  scopes: McpScope[];
  codeChallenge: string;
  redirectUri: string;
  resource: string;
  expiresAt: string;
  usedAt: string | null;
}

export type OAuthTokenKind = 'access' | 'refresh';

export interface TokenRecord {
  tokenHash: string;
  connectionId: string;
  kind: OAuthTokenKind | 'pat';
  expiresAt: string | null;
  /** The hash of the refresh token this one replaced. */
  rotatedFrom: string | null;
  revokedAt: string | null;
  audience: string | null;
}

export interface ConnectionRecord {
  id: string;
  userId: string;
  accountId: string;
  clientId: string | null;
  kind: 'oauth' | 'pat';
  name: string;
  scopes: McpScope[];
  revokedAt: string | null;
}

export interface OAuthStore {
  getClient(clientId: string): Promise<OAuthClientRecord | null>;
  saveClient(client: OAuthClientRecord): Promise<void>;

  saveCode(code: AuthorizationCodeRecord): Promise<void>;
  /**
   * Marks a code used and returns it, exactly once: a second call for the
   * same hash returns `{ reason: 'used' }`. Expiry is the caller's check,
   * so an expired code is still consumed (and so cannot be retried).
   */
  consumeCode(
    codeHash: string,
    now: Date,
  ): Promise<
    | { ok: true; code: AuthorizationCodeRecord }
    | { ok: false; reason: 'unknown' | 'used' }
  >;

  createConnection(input: {
    userId: string;
    accountId: string;
    clientId: string;
    name: string;
    scopes: McpScope[];
  }): Promise<ConnectionRecord>;
  getConnection(connectionId: string): Promise<ConnectionRecord | null>;
  /** Sets revoked_at on the connection and every live token of it. */
  revokeConnection(connectionId: string, now: Date): Promise<void>;

  saveTokens(tokens: TokenRecord[]): Promise<void>;
  getToken(tokenHash: string): Promise<TokenRecord | null>;
  revokeToken(tokenHash: string, now: Date): Promise<void>;
  /** Whether a token was already rotated: some token names it as `rotatedFrom`. */
  hasRotatedChild(tokenHash: string): Promise<boolean>;
}

/** The store the unit tests run the grant logic against. */
export function createMemoryOAuthStore(): OAuthStore & {
  clients: Map<string, OAuthClientRecord>;
  codes: Map<string, AuthorizationCodeRecord>;
  connections: Map<string, ConnectionRecord>;
  tokens: Map<string, TokenRecord>;
} {
  const clients = new Map<string, OAuthClientRecord>();
  const codes = new Map<string, AuthorizationCodeRecord>();
  const connections = new Map<string, ConnectionRecord>();
  const tokens = new Map<string, TokenRecord>();
  let nextConnection = 1;

  return {
    clients,
    codes,
    connections,
    tokens,

    async getClient(clientId) {
      return clients.get(clientId) ?? null;
    },
    async saveClient(client) {
      clients.set(client.clientId, client);
    },

    async saveCode(code) {
      codes.set(code.codeHash, code);
    },
    async consumeCode(codeHash, now) {
      const code = codes.get(codeHash);

      if (!code) return { ok: false, reason: 'unknown' };
      if (code.usedAt) return { ok: false, reason: 'used' };

      const used = { ...code, usedAt: now.toISOString() };
      codes.set(codeHash, used);

      return { ok: true, code: used };
    },

    async createConnection(input) {
      const id = `00000000-0000-4000-8000-${String(nextConnection++).padStart(12, '0')}`;
      const connection: ConnectionRecord = {
        id,
        userId: input.userId,
        accountId: input.accountId,
        clientId: input.clientId,
        kind: 'oauth',
        name: input.name,
        scopes: input.scopes,
        revokedAt: null,
      };

      connections.set(id, connection);

      return connection;
    },
    async getConnection(connectionId) {
      return connections.get(connectionId) ?? null;
    },
    async revokeConnection(connectionId, now) {
      const connection = connections.get(connectionId);

      if (connection && !connection.revokedAt) {
        connections.set(connectionId, {
          ...connection,
          revokedAt: now.toISOString(),
        });
      }

      for (const [hash, token] of tokens) {
        if (token.connectionId === connectionId && !token.revokedAt) {
          tokens.set(hash, { ...token, revokedAt: now.toISOString() });
        }
      }
    },

    async saveTokens(rows) {
      for (const row of rows) tokens.set(row.tokenHash, row);
    },
    async getToken(tokenHash) {
      return tokens.get(tokenHash) ?? null;
    },
    async revokeToken(tokenHash, now) {
      const token = tokens.get(tokenHash);

      if (token && !token.revokedAt) {
        tokens.set(tokenHash, { ...token, revokedAt: now.toISOString() });
      }
    },
    async hasRotatedChild(tokenHash) {
      for (const token of tokens.values()) {
        if (token.rotatedFrom === tokenHash) return true;
      }

      return false;
    },
  };
}
