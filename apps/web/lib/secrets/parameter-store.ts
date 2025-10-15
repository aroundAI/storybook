/**
 * AWS Systems Manager Parameter Store Utility
 *
 * Securely fetches secrets from AWS Systems Manager Parameter Store
 * with caching to minimize API calls and improve performance.
 *
 * Benefits:
 * - Secrets never exposed in CloudTrail logs (only parameter names logged)
 * - KMS encryption at rest
 * - Secret rotation without code redeployment
 * - Fine-grained IAM permissions
 */

import {
  SSMClient,
  GetParameterCommand,
  GetParametersCommand,
} from '@aws-sdk/client-ssm';

/**
 * In-memory cache for fetched parameters
 * Cache TTL: 5 minutes (balances security vs performance)
 */
interface CachedParameter {
  value: string;
  expiresAt: number;
}

const parameterCache = new Map<string, CachedParameter>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * SSM Client singleton
 */
let ssmClient: SSMClient | null = null;

/**
 * Get or create SSM client
 */
function getSSMClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return ssmClient;
}

/**
 * Check if cached parameter is still valid
 */
function getCachedParameter(name: string): string | null {
  const cached = parameterCache.get(name);
  if (!cached) {
    return null;
  }

  if (Date.now() > cached.expiresAt) {
    parameterCache.delete(name);
    return null;
  }

  return cached.value;
}

/**
 * Cache parameter value
 */
function cacheParameter(name: string, value: string): void {
  parameterCache.set(name, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

/**
 * Fetch a single parameter from Parameter Store
 *
 * @param name - Parameter name (e.g., '/prod/db/password')
 * @param options - Fetch options
 * @returns Parameter value
 *
 * @example
 * ```typescript
 * const dbPassword = await getParameter('/prod/db/password');
 * ```
 */
export async function getParameter(
  name: string,
  options: {
    withDecryption?: boolean;
    skipCache?: boolean;
  } = {},
): Promise<string> {
  const { withDecryption = true, skipCache = false } = options;

  // Check cache first (unless explicitly skipped)
  if (!skipCache) {
    const cached = getCachedParameter(name);
    if (cached !== null) {
      return cached;
    }
  }

  try {
    const client = getSSMClient();
    const command = new GetParameterCommand({
      Name: name,
      WithDecryption: withDecryption,
    });

    const response = await client.send(command);

    if (!response.Parameter?.Value) {
      throw new Error(`Parameter ${name} has no value`);
    }

    const value = response.Parameter.Value;

    // Cache the result
    if (!skipCache) {
      cacheParameter(name, value);
    }

    return value;
  } catch (error) {
    console.error(`[ParameterStore] Failed to fetch parameter ${name}:`, error);
    throw new Error(
      `Failed to fetch parameter ${name}: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Fetch multiple parameters from Parameter Store in a single API call
 *
 * @param names - Array of parameter names
 * @param options - Fetch options
 * @returns Record of parameter names to values
 *
 * @example
 * ```typescript
 * const secrets = await getParameters([
 *   '/prod/db/password',
 *   '/prod/stripe/secret-key'
 * ]);
 * const dbPassword = secrets['/prod/db/password'];
 * ```
 */
export async function getParameters(
  names: string[],
  options: {
    withDecryption?: boolean;
    skipCache?: boolean;
  } = {},
): Promise<Record<string, string>> {
  const { withDecryption = true, skipCache = false } = options;

  // Check cache for all parameters
  const results: Record<string, string> = {};
  const uncachedNames: string[] = [];

  for (const name of names) {
    if (!skipCache) {
      const cached = getCachedParameter(name);
      if (cached !== null) {
        results[name] = cached;
        continue;
      }
    }
    uncachedNames.push(name);
  }

  // If all parameters are cached, return immediately
  if (uncachedNames.length === 0) {
    return results;
  }

  // Fetch uncached parameters
  // SSM GetParameters supports up to 10 parameters per call
  const BATCH_SIZE = 10;
  const batches: string[][] = [];

  for (let i = 0; i < uncachedNames.length; i += BATCH_SIZE) {
    batches.push(uncachedNames.slice(i, i + BATCH_SIZE));
  }

  try {
    const client = getSSMClient();

    for (const batch of batches) {
      const command = new GetParametersCommand({
        Names: batch,
        WithDecryption: withDecryption,
      });

      const response = await client.send(command);

      if (response.Parameters) {
        for (const param of response.Parameters) {
          if (param.Name && param.Value) {
            results[param.Name] = param.Value;

            // Cache the result
            if (!skipCache) {
              cacheParameter(param.Name, param.Value);
            }
          }
        }
      }

      // Log any invalid parameters
      if (response.InvalidParameters && response.InvalidParameters.length > 0) {
        console.error(
          '[ParameterStore] Invalid parameters:',
          response.InvalidParameters,
        );
      }
    }

    // Check if all requested parameters were found
    const missingParams = uncachedNames.filter((name) => !(name in results));
    if (missingParams.length > 0) {
      throw new Error(
        `Missing parameters: ${missingParams.join(', ')}`,
      );
    }

    return results;
  } catch (error) {
    console.error('[ParameterStore] Failed to fetch parameters:', error);
    throw new Error(
      `Failed to fetch parameters: ${error instanceof Error ? error.message : 'Unknown error'}`,
    );
  }
}

/**
 * Get parameter with fallback to environment variable
 *
 * This is useful during migration from environment variables to Parameter Store.
 * First tries to fetch from Parameter Store, falls back to env var if not found.
 *
 * @param paramName - Parameter Store name
 * @param envVarName - Environment variable name as fallback
 * @returns Parameter value
 *
 * @example
 * ```typescript
 * // Tries /prod/db/password first, falls back to POSTGRES_PASSWORD env var
 * const password = await getParameterWithFallback(
 *   '/prod/db/password',
 *   'POSTGRES_PASSWORD'
 * );
 * ```
 */
export async function getParameterWithFallback(
  paramName: string,
  envVarName: string,
): Promise<string> {
  try {
    return await getParameter(paramName);
  } catch {
    console.warn(
      `[ParameterStore] Failed to fetch ${paramName}, falling back to env var ${envVarName}`,
    );

    const envValue = process.env[envVarName];
    if (!envValue) {
      throw new Error(
        `Neither Parameter Store parameter ${paramName} nor environment variable ${envVarName} is set`,
      );
    }

    return envValue;
  }
}

/**
 * Clear the parameter cache
 *
 * Useful for testing or when you need to force refresh
 */
export function clearParameterCache(): void {
  parameterCache.clear();
}

/**
 * Helper to get database credentials from Parameter Store
 *
 * @param stage - Deployment stage (production, staging, dev)
 * @returns Database connection parameters
 */
export async function getDatabaseCredentials(stage: string) {
  const params = await getParameters([
    `/${stage}/db/host`,
    `/${stage}/db/port`,
    `/${stage}/db/name`,
    `/${stage}/db/user`,
    `/${stage}/db/password`,
  ]);

  // Type assertion safe because getParameters validates all parameters exist
  return {
    host: params[`/${stage}/db/host`]!,
    port: parseInt(params[`/${stage}/db/port`]!, 10),
    database: params[`/${stage}/db/name`]!,
    user: params[`/${stage}/db/user`]!,
    password: params[`/${stage}/db/password`]!,
  };
}

/**
 * Helper to get Stripe credentials from Parameter Store
 *
 * @param stage - Deployment stage
 * @returns Stripe API keys
 */
export async function getStripeCredentials(stage: string) {
  const params = await getParameters([
    `/${stage}/stripe/secret-key`,
    `/${stage}/stripe/webhook-secret`,
  ]);

  // Type assertion safe because getParameters validates all parameters exist
  return {
    secretKey: params[`/${stage}/stripe/secret-key`]!,
    webhookSecret: params[`/${stage}/stripe/webhook-secret`]!,
  };
}

/**
 * Helper to get Cognito credentials from Parameter Store
 *
 * @param stage - Deployment stage
 * @returns Cognito configuration
 */
export async function getCognitoCredentials(stage: string) {
  const params = await getParameters([
    `/${stage}/cognito/user-pool-id`,
    `/${stage}/cognito/client-id`,
    `/${stage}/cognito/client-secret`,
  ]);

  // Type assertion safe because getParameters validates all parameters exist
  return {
    userPoolId: params[`/${stage}/cognito/user-pool-id`]!,
    clientId: params[`/${stage}/cognito/client-id`]!,
    clientSecret: params[`/${stage}/cognito/client-secret`]!,
  };
}
