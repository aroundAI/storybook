/**
 * Provider types for vendor-agnostic infrastructure
 */

export type DatabaseProvider = 'supabase' | 'postgresql' | 'mysql';
export type AuthProvider = 'supabase' | 'cognito' | 'auth0' | 'clerk';
export type StorageProvider = 'supabase' | 's3';
export type EmailProvider = 'resend' | 'ses' | 'sendgrid' | 'nodemailer';
export type QueueProvider = 'sqs' | 'bullmq';
export type RealtimeProvider = 'supabase' | 'websocket' | 'pusher';
export type CacheProvider = 'redis' | 'memory';

/**
 * Infrastructure configuration
 */
export interface InfrastructureConfig {
  database: {
    provider: DatabaseProvider;
    config: Record<string, string>;
  };
  auth: {
    provider: AuthProvider;
    config: Record<string, string>;
  };
  storage: {
    provider: StorageProvider;
    config: Record<string, string>;
  };
  email: {
    provider: EmailProvider;
    config: Record<string, string>;
  };
  queue?: {
    provider: QueueProvider;
    config: Record<string, string>;
  };
  realtime?: {
    provider: RealtimeProvider;
    config: Record<string, string>;
  };
  cache?: {
    provider: CacheProvider;
    config: Record<string, string>;
  };
}

/**
 * Provider initialization result
 */
export interface ProviderInitResult<T> {
  provider: T;
  config: Record<string, string>;
}
