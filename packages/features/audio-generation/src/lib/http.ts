/**
 * Shared HTTP utilities for audio generation providers
 */

export interface RetryConfig {
  maxRetries?: number;
  timeout?: number;
  baseDelay?: number;
  maxDelay?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRY_AFTER_MS = 60000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function parseRetryAfterMs(header: string | null | undefined): number | null {
  if (!header) {
    return null;
  }

  const seconds = Number(header);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }

  const date = Date.parse(header);

  if (Number.isNaN(date)) {
    return null;
  }

  return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
}

const DEFAULT_RETRY_CONFIG: Required<Omit<RetryConfig, 'sleep'>> = {
  maxRetries: 5,
  timeout: 30000,
  baseDelay: 1000,
  maxDelay: 10000,
};

/**
 * Make HTTP request with exponential backoff retry logic
 * Extracts common retry pattern used by all providers
 */
export async function fetchWithRetry<T>(
  url: string,
  options: RequestInit,
  config: RetryConfig = {},
  binary: boolean = false,
): Promise<T> {
  const { maxRetries, timeout, baseDelay, maxDelay } = {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };
  const sleep = config.sleep ?? defaultSleep;

  let retryAfterMs: number | null = null;
  let lastError = new Error('Request failed after retries');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        retryAfterMs =
          response.status === 429
            ? parseRetryAfterMs(response.headers?.get('retry-after'))
            : null;
        const errorData = await response.json().catch(() => ({}));
        // ElevenLabs uses { detail: { message: "..." } } or { detail: "string" }
        const detail = (errorData as Record<string, unknown>)?.detail;
        const message =
          typeof detail === 'object' && detail !== null
            ? (detail as Record<string, unknown>)?.message
            : typeof detail === 'string'
              ? detail
              : ((errorData as Record<string, unknown>)?.message ??
                response.statusText);
        throw new Error(`API error (${response.status}): ${String(message)}`);
      }

      if (binary) {
        return (await response.arrayBuffer()) as T;
      }

      return (await response.json()) as T;
    } catch (error) {
      lastError =
        error instanceof Error ? error : new Error('Unknown error occurred');

      // Don't retry on validation errors
      if (lastError.message.includes('Invalid request')) {
        throw lastError;
      }

      // Don't retry on client errors (4xx) — they're permanent. A 429 is a
      // rate limit that clears, so it is retried.
      if (
        /API error \(4\d\d\)/.test(lastError.message) &&
        !lastError.message.startsWith('API error (429)')
      ) {
        throw lastError;
      }

      // Exponential backoff with jitter (±25% randomization)
      if (attempt < maxRetries - 1) {
        const baseBackoff = Math.min(
          baseDelay * Math.pow(2, attempt),
          maxDelay,
        );
        const jitter = baseBackoff * 0.25 * (Math.random() * 2 - 1); // -25% to +25%
        const delay = retryAfterMs ?? Math.max(0, baseBackoff + jitter);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Format provider errors consistently
 */
export function formatProviderError(
  providerName: string,
  operation: string,
  error: unknown,
): Error {
  if (error instanceof Error) {
    return new Error(`${providerName} ${operation} failed: ${error.message}`);
  }
  return new Error(`${providerName} ${operation} failed: Unknown error`);
}

export function assertApiKey(providerName: string, apiKey: string): void {
  if (!apiKey || apiKey.trim() === '') {
    throw new Error(`${providerName} API key is missing or empty`);
  }
}

/**
 * Format a provider error and log it with provider and operation context.
 * Uses console, as the lambda workers do; the API key is redacted.
 */
export function handleProviderError(
  providerName: string,
  operation: string,
  error: unknown,
  apiKey?: string,
): Error {
  const formatted = formatProviderError(providerName, operation, error);
  const message =
    apiKey && apiKey.trim() !== ''
      ? formatted.message.split(apiKey).join('[redacted]')
      : formatted.message;

  console.error('[audio-generation] provider error', {
    provider: providerName,
    operation,
    message,
  });

  return formatted;
}
