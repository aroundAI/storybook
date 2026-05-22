/**
 * ClickHouse Client (Singleton)
 *
 * Provides a configured ClickHouse client instance.
 * Uses @clickhouse/client with env-based configuration.
 */
import { type ClickHouseClient, createClient } from '@clickhouse/client';

let clientInstance: ClickHouseClient | null = null;

/**
 * Environment variable names for ClickHouse configuration
 */
const ENV_KEYS = {
  HOST: 'CLICKHOUSE_HOST',
  USER: 'CLICKHOUSE_USER',
  PASSWORD: 'CLICKHOUSE_PASSWORD',
  DATABASE: 'CLICKHOUSE_DB',
} as const;

/**
 * Get the ClickHouse configuration from environment variables.
 * Throws if required variables are missing.
 */
function getConfig() {
  const host = process.env[ENV_KEYS.HOST];

  if (!host) {
    throw new Error(
      `Missing required environment variable: ${ENV_KEYS.HOST}. ` +
        `Set CLICKHOUSE_HOST, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, and CLICKHOUSE_DB.`,
    );
  }

  return {
    url: host,
    username: process.env[ENV_KEYS.USER] ?? 'default',
    password: process.env[ENV_KEYS.PASSWORD] ?? '',
    database: process.env[ENV_KEYS.DATABASE] ?? 'default',
  };
}

/**
 * Returns the singleton ClickHouse client instance.
 * Creates one on first call, reuses it on subsequent calls.
 */
export function getClickHouseClient(): ClickHouseClient {
  if (!clientInstance) {
    const config = getConfig();

    clientInstance = createClient({
      url: config.url,
      username: config.username,
      password: config.password,
      database: config.database,
      clickhouse_settings: {
        // Return dates as strings in ISO format
        date_time_output_format: 'iso',
        // Optimize for analytical queries
        max_threads: 4,
      },
      request_timeout: 30_000,
    });
  }

  return clientInstance;
}

/**
 * Close the ClickHouse client connection.
 * Useful for graceful shutdown or testing.
 */
export async function closeClickHouseClient(): Promise<void> {
  if (clientInstance) {
    await clientInstance.close();
    clientInstance = null;
  }
}

/**
 * Check if the ClickHouse client is connected and healthy.
 */
export async function pingClickHouse(): Promise<boolean> {
  try {
    const client = getClickHouseClient();
    const result = await client.ping();

    return result.success;
  } catch {
    return false;
  }
}

/**
 * Check if ClickHouse is enabled via environment variable.
 * Use this to gate dual-write during migration.
 */
export function isClickHouseEnabled(): boolean {
  return process.env.CLICKHOUSE_ENABLED === 'true';
}
