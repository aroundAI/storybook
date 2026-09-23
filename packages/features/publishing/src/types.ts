/**
 * Platform connection types for managing OAuth connections to publishing platforms
 */
import type { AnalyticsAccess } from './oauth/analytics-scopes';

export type PlatformType =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'linkedin';

export type ConnectionStatus = 'active' | 'expired' | 'error' | 'disconnected';

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
  /** When the creator disconnected it in the app (KB-22); null while connected. */
  disconnectedAt?: string | null;
  /** The latest deletion of its vendor statistics (KB-22 part B), if any. */
  vendorDataPurge?: { completedAt: string | null; dueBy: string };
  /** The Instagram account or Facebook Page disconnected together with this one. */
  linkedAccountName?: string;
  createdAt: string;
  updatedAt: string;
  accountSlug: string;
  language?: string; // Target language for this channel (en, hi, es, etc.)
  /** Null for a platform with no analytics requirement (LinkedIn). */
  analyticsAccess?: AnalyticsAccess | null;
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
