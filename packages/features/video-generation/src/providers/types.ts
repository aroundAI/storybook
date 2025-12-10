import type { VideoGenerationProvider } from './base';

/**
 * Video provider names supported by the factory
 */
export type VideoProviderName = 'kling' | 'runway' | 'luma' | 'hailuo';

/**
 * Provider metadata for UI display and selection
 */
export interface VideoProviderMetadata {
  /** Provider identifier */
  name: VideoProviderName;
  /** Human-readable display name */
  displayName: string;
  /** Description of the provider */
  description: string;
  /** Supported aspect ratios */
  supportedAspectRatios: readonly string[];
  /** Maximum video duration in seconds */
  maxDuration: number;
  /** Minimum video duration in seconds */
  minDuration: number;
  /** Whether provider supports image-to-video */
  supportsImageToVideo: boolean;
  /** Cost per second in cents */
  costPerSecond: {
    standard: number;
    professional: number;
  };
}

/**
 * Configuration for creating a video provider instance
 */
export interface VideoProviderConfig {
  /** API key for the provider */
  apiKey: string;
  /** Webhook URL for status callbacks */
  webhookUrl: string;
  /** Optional custom base URL */
  baseUrl?: string;
  /** Optional timeout in milliseconds */
  timeout?: number;
}

/**
 * Options for the account-aware provider factory
 */
export interface ProviderFactoryOptions {
  /** Account ID to load configuration for */
  accountId: string;
  /** Specific provider to use (optional - falls back to first available) */
  provider?: VideoProviderName;
  /** Base URL for webhook callbacks */
  webhookBaseUrl?: string;
}

/**
 * Registry entry for a provider
 */
export interface ProviderRegistryEntry {
  /** Provider metadata for display */
  metadata: VideoProviderMetadata;
  /** Factory function to create provider instance */
  factory: (config: VideoProviderConfig) => VideoGenerationProvider;
}
