/**
 * Local database types for platform_connections and oauth_states tables.
 * These will be merged into the main database.types.ts after migrations are applied.
 */

export interface PlatformConnection {
  id: string;
  account_id: string;
  platform: string;
  platform_account_id: string | null;
  platform_account_name: string | null;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  scopes: string[] | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  language: string; // Target language for this channel (en, hi, es, pt, etc.)
  created_at: string;
  updated_at: string;
}

export interface PlatformConnectionInsert {
  id?: string;
  account_id: string;
  platform: string;
  platform_account_id?: string | null;
  platform_account_name?: string | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
  language?: string; // Default: 'en'
  created_at?: string;
  updated_at?: string;
}

export interface PlatformConnectionUpdate {
  id?: string;
  account_id?: string;
  platform?: string;
  platform_account_id?: string | null;
  platform_account_name?: string | null;
  access_token_encrypted?: string | null;
  refresh_token_encrypted?: string | null;
  token_expires_at?: string | null;
  scopes?: string[] | null;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
  language?: string;
  created_at?: string;
  updated_at?: string;
}

export interface OAuthState {
  id: string;
  nonce: string;
  user_id: string;
  platform: string;
  metadata: Record<string, unknown>;
  expires_at: string;
  created_at: string;
}

export interface OAuthStateInsert {
  id?: string;
  nonce: string;
  user_id: string;
  platform: string;
  metadata?: Record<string, unknown>;
  expires_at: string;
  created_at?: string;
}
