import { z } from 'zod';

import type {
  AuthProvider,
  CacheProvider,
  DatabaseProvider,
  EmailProvider,
  InfrastructureConfig,
  QueueProvider,
  RealtimeProvider,
  StorageProvider,
} from './types';

/**
 * Zod schemas for runtime validation of infrastructure configuration
 */

// Provider enum schemas
const DatabaseProviderSchema = z.enum(['supabase', 'postgresql', 'mysql']);
const AuthProviderSchema = z.enum(['supabase', 'cognito', 'auth0', 'clerk']);
const StorageProviderSchema = z.enum(['supabase', 's3']);
const EmailProviderSchema = z.enum(['resend', 'ses', 'sendgrid', 'nodemailer']);
const QueueProviderSchema = z.enum(['sqs', 'bullmq']);
const RealtimeProviderSchema = z.enum(['supabase', 'websocket', 'pusher']);
const CacheProviderSchema = z.enum(['redis', 'memory']);

// Provider-specific configuration schemas
const SupabaseConfigSchema = z.object({
  url: z.string().url('Invalid Supabase URL'),
  anonKey: z.string().min(1, 'Supabase anon key is required'),
  serviceRoleKey: z
    .string()
    .min(1, 'Supabase service role key is required')
    .optional(),
});

const PostgresConfigSchema = z.object({
  host: z.string().min(1, 'PostgreSQL host is required'),
  port: z.string().regex(/^\d+$/, 'PostgreSQL port must be a number'),
  database: z.string().min(1, 'PostgreSQL database name is required'),
  user: z.string().min(1, 'PostgreSQL user is required'),
  password: z.string().min(1, 'PostgreSQL password is required'),
});

const CognitoConfigSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  userPoolId: z.string().min(1, 'Cognito user pool ID is required'),
  clientId: z.string().min(1, 'Cognito client ID is required'),
  clientSecret: z.string().min(1, 'Cognito client secret is required'),
});

const S3ConfigSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  bucket: z.string().min(1, 'S3 bucket name is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
});

const SESConfigSchema = z.object({
  region: z.string().min(1, 'AWS region is required'),
  accessKeyId: z.string().min(1, 'AWS access key ID is required'),
  secretAccessKey: z.string().min(1, 'AWS secret access key is required'),
});

/**
 * Validate provider configuration at runtime
 */
function validateProviderConfig<T>(
  providerName: string,
  provider: string,
  config: Record<string, string>,
  schema?: z.ZodSchema<T>,
): void {
  if (!schema) {
    return; // No validation schema provided
  }

  try {
    schema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const messages = error.errors.map(
        (err) => `  - ${err.path.join('.')}: ${err.message}`,
      );
      throw new Error(
        `Invalid ${providerName} configuration for provider "${provider}":\n${messages.join('\n')}`,
      );
    }
    throw error;
  }
}

/**
 * Load infrastructure configuration from environment variables
 * @throws {Error} If configuration is invalid or missing required fields
 */
export function loadInfrastructureConfig(): InfrastructureConfig {
  // Database configuration
  const databaseProviderRaw = process.env.DATABASE_PROVIDER ?? 'supabase';
  const databaseProvider = DatabaseProviderSchema.parse(databaseProviderRaw);

  const databaseConfig = getDatabaseConfig(databaseProvider);

  // Validate database configuration based on provider
  if (databaseProvider === 'supabase') {
    validateProviderConfig(
      'database',
      databaseProvider,
      databaseConfig,
      SupabaseConfigSchema,
    );
  } else if (
    databaseProvider === 'postgresql' ||
    databaseProvider === 'mysql'
  ) {
    validateProviderConfig(
      'database',
      databaseProvider,
      databaseConfig,
      PostgresConfigSchema,
    );
  }

  // Auth configuration
  const authProviderRaw = process.env.AUTH_PROVIDER ?? 'supabase';
  const authProvider = AuthProviderSchema.parse(authProviderRaw);

  const authConfig = getAuthConfig(authProvider);

  // Validate auth configuration based on provider
  if (authProvider === 'supabase') {
    validateProviderConfig(
      'auth',
      authProvider,
      authConfig,
      SupabaseConfigSchema,
    );
  } else if (authProvider === 'cognito') {
    validateProviderConfig(
      'auth',
      authProvider,
      authConfig,
      CognitoConfigSchema,
    );
  }

  // Storage configuration
  const storageProviderRaw = process.env.STORAGE_PROVIDER ?? 'supabase';
  const storageProvider = StorageProviderSchema.parse(storageProviderRaw);

  const storageConfig = getStorageConfig(storageProvider);

  // Validate storage configuration based on provider
  if (storageProvider === 'supabase') {
    validateProviderConfig(
      'storage',
      storageProvider,
      storageConfig,
      SupabaseConfigSchema,
    );
  } else if (storageProvider === 's3') {
    validateProviderConfig(
      'storage',
      storageProvider,
      storageConfig,
      S3ConfigSchema,
    );
  }

  // Email configuration
  const emailProviderRaw = process.env.EMAIL_PROVIDER ?? 'resend';
  const emailProvider = EmailProviderSchema.parse(emailProviderRaw);

  const emailConfig = getEmailConfig(emailProvider);

  // Validate email configuration based on provider
  if (emailProvider === 'ses') {
    validateProviderConfig(
      'email',
      emailProvider,
      emailConfig,
      SESConfigSchema,
    );
  }

  // Optional: Queue configuration
  const queueProviderRaw = process.env.QUEUE_PROVIDER;
  const queueProvider = queueProviderRaw
    ? QueueProviderSchema.parse(queueProviderRaw)
    : undefined;

  const queueConfig = queueProvider ? getQueueConfig(queueProvider) : undefined;

  // Optional: Realtime configuration
  const realtimeProviderRaw = process.env.REALTIME_PROVIDER;
  const realtimeProvider = realtimeProviderRaw
    ? RealtimeProviderSchema.parse(realtimeProviderRaw)
    : undefined;

  const realtimeConfig = realtimeProvider
    ? getRealtimeConfig(realtimeProvider)
    : undefined;

  // Optional: Cache configuration
  const cacheProviderRaw = process.env.CACHE_PROVIDER;
  const cacheProvider = cacheProviderRaw
    ? CacheProviderSchema.parse(cacheProviderRaw)
    : undefined;
  const cacheConfig = cacheProvider ? getCacheConfig(cacheProvider) : undefined;

  return {
    database: {
      provider: databaseProvider,
      config: databaseConfig,
    },
    auth: {
      provider: authProvider,
      config: authConfig,
    },
    storage: {
      provider: storageProvider,
      config: storageConfig,
    },
    email: {
      provider: emailProvider,
      config: emailConfig,
    },
    ...(queueProvider &&
      queueConfig && {
        queue: {
          provider: queueProvider,
          config: queueConfig,
        },
      }),
    ...(realtimeProvider &&
      realtimeConfig && {
        realtime: {
          provider: realtimeProvider,
          config: realtimeConfig,
        },
      }),
    ...(cacheProvider &&
      cacheConfig && {
        cache: {
          provider: cacheProvider,
          config: cacheConfig,
        },
      }),
  };
}

function getDatabaseConfig(provider: DatabaseProvider): Record<string, string> {
  switch (provider) {
    case 'supabase':
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      };

    case 'postgresql':
      return {
        host: process.env.POSTGRES_HOST ?? 'localhost',
        port: process.env.POSTGRES_PORT ?? '5432',
        database: process.env.POSTGRES_DB ?? '',
        user: process.env.POSTGRES_USER ?? '',
        password: process.env.POSTGRES_PASSWORD ?? '',
      };

    case 'mysql':
      return {
        host: process.env.MYSQL_HOST ?? 'localhost',
        port: process.env.MYSQL_PORT ?? '3306',
        database: process.env.MYSQL_DB ?? '',
        user: process.env.MYSQL_USER ?? '',
        password: process.env.MYSQL_PASSWORD ?? '',
      };

    default:
      throw new Error(`Unsupported database provider: ${provider}`);
  }
}

function getAuthConfig(provider: AuthProvider): Record<string, string> {
  switch (provider) {
    case 'supabase':
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      };

    case 'cognito':
      return {
        region: process.env.AWS_REGION ?? 'us-east-1',
        userPoolId: process.env.COGNITO_USER_POOL_ID ?? '',
        clientId: process.env.COGNITO_CLIENT_ID ?? '',
        clientSecret: process.env.COGNITO_CLIENT_SECRET ?? '',
      };

    case 'auth0':
      return {
        domain: process.env.AUTH0_DOMAIN ?? '',
        clientId: process.env.AUTH0_CLIENT_ID ?? '',
        clientSecret: process.env.AUTH0_CLIENT_SECRET ?? '',
      };

    case 'clerk':
      return {
        publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
        secretKey: process.env.CLERK_SECRET_KEY ?? '',
      };

    default:
      throw new Error(`Unsupported auth provider: ${provider}`);
  }
}

function getStorageConfig(provider: StorageProvider): Record<string, string> {
  switch (provider) {
    case 'supabase':
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      };

    case 's3':
      return {
        region: process.env.AWS_REGION ?? 'us-east-1',
        bucket: process.env.S3_BUCKET ?? '',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      };

    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}

function getEmailConfig(provider: EmailProvider): Record<string, string> {
  switch (provider) {
    case 'resend':
      return {
        apiKey: process.env.RESEND_API_KEY ?? '',
      };

    case 'ses':
      return {
        region: process.env.AWS_REGION ?? 'us-east-1',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      };

    case 'sendgrid':
      return {
        apiKey: process.env.SENDGRID_API_KEY ?? '',
      };

    case 'nodemailer':
      return {
        host: process.env.EMAIL_HOST ?? '',
        port: process.env.EMAIL_PORT ?? '587',
        user: process.env.EMAIL_USER ?? '',
        password: process.env.EMAIL_PASSWORD ?? '',
        tls: process.env.EMAIL_TLS ?? 'true',
      };

    default:
      throw new Error(`Unsupported email provider: ${provider}`);
  }
}

function getQueueConfig(provider: QueueProvider): Record<string, string> {
  switch (provider) {
    case 'sqs':
      return {
        region: process.env.AWS_REGION ?? 'us-east-1',
        queueUrl: process.env.SQS_QUEUE_URL ?? '',
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
      };

    case 'bullmq':
      return {
        redis: process.env.REDIS_URL ?? 'redis://localhost:6379',
      };

    default:
      throw new Error(`Unsupported queue provider: ${provider}`);
  }
}

function getRealtimeConfig(provider: RealtimeProvider): Record<string, string> {
  switch (provider) {
    case 'supabase':
      return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
      };

    case 'websocket':
      return {
        url: process.env.WEBSOCKET_URL ?? '',
      };

    case 'pusher':
      return {
        appId: process.env.PUSHER_APP_ID ?? '',
        key: process.env.NEXT_PUBLIC_PUSHER_KEY ?? '',
        secret: process.env.PUSHER_SECRET ?? '',
        cluster: process.env.PUSHER_CLUSTER ?? 'us2',
      };

    default:
      throw new Error(`Unsupported realtime provider: ${provider}`);
  }
}

function getCacheConfig(provider: CacheProvider): Record<string, string> {
  switch (provider) {
    case 'redis':
      return {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      };

    case 'memory':
      return {};

    default:
      throw new Error(`Unsupported cache provider: ${provider}`);
  }
}
