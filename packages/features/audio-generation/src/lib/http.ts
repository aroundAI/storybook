/**
 * Shared HTTP utilities for audio generation providers
 */

export interface RetryConfig {
  maxRetries?: number;
  timeout?: number;
  baseDelay?: number;
  maxDelay?: number;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
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

  let lastError = new Error('Request failed after retries');

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
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

      // Don't retry on client errors (4xx) — they're permanent
      if (/API error \(4\d\d\)/.test(lastError.message)) {
        throw lastError;
      }

      // Exponential backoff with jitter (±25% randomization)
      if (attempt < maxRetries - 1) {
        const baseBackoff = Math.min(
          baseDelay * Math.pow(2, attempt),
          maxDelay,
        );
        const jitter = baseBackoff * 0.25 * (Math.random() * 2 - 1); // -25% to +25%
        const delay = Math.max(0, baseBackoff + jitter);
        await new Promise((resolve) => setTimeout(resolve, delay));
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
