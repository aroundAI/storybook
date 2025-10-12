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
 * Load infrastructure configuration from environment variables
 */
export function loadInfrastructureConfig(): InfrastructureConfig {
  // Database configuration
  const databaseProvider = (process.env.DATABASE_PROVIDER ??
    'supabase') as DatabaseProvider;

  const databaseConfig = getDatabaseConfig(databaseProvider);

  // Auth configuration
  const authProvider = (process.env.AUTH_PROVIDER ??
    'supabase') as AuthProvider;

  const authConfig = getAuthConfig(authProvider);

  // Storage configuration
  const storageProvider = (process.env.STORAGE_PROVIDER ??
    'supabase') as StorageProvider;

  const storageConfig = getStorageConfig(storageProvider);

  // Email configuration
  const emailProvider = (process.env.EMAIL_PROVIDER ??
    'resend') as EmailProvider;

  const emailConfig = getEmailConfig(emailProvider);

  // Optional: Queue configuration
  const queueProvider = process.env.QUEUE_PROVIDER as QueueProvider | undefined;

  const queueConfig = queueProvider ? getQueueConfig(queueProvider) : undefined;

  // Optional: Realtime configuration
  const realtimeProvider = process.env.REALTIME_PROVIDER as
    | RealtimeProvider
    | undefined;

  const realtimeConfig = realtimeProvider
    ? getRealtimeConfig(realtimeProvider)
    : undefined;

  // Optional: Cache configuration
  const cacheProvider = process.env.CACHE_PROVIDER as CacheProvider | undefined;
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
