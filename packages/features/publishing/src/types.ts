/**
 * Platform connection types for managing OAuth connections to publishing platforms
 */

export type PlatformType =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'linkedin';

export type ConnectionStatus = 'active' | 'expired' | 'error';

/**
 * Platform connection as returned from server actions
 */
export interface PlatformConnection {
  id: string;
  platform: PlatformType;
  platformAccountId: string;
  accountName: string;
  profileImageUrl?: string;
  status: ConnectionStatus;
  errorMessage?: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  accountSlug: string;
}

/**
 * Platform configuration for UI display
 */
export interface PlatformConfig {
  id: PlatformType;
  name: string;
  description: string;
  scopes: string[];
  multiAccount: boolean;
  color: string;
}
