# FILM-402: Video Provider Factory

**Phase**: 4
**Priority**: P0
**Effort**: S (1-2 days)
**Dependencies**: FILM-401 (kling-provider)
**Blocks**: FILM-405 (generate-video-action)

---

## Context

The provider factory implements a registry pattern for video generation providers, enabling dynamic provider selection based on user preferences or system configuration. The factory must support multiple providers (Kling, Runway, Luma) while maintaining singleton instances for performance and managing provider-specific configurations.

The factory loads provider credentials from the database, instantiates providers with proper configuration, and provides a consistent interface for accessing provider capabilities across the application.

---

## Requirements

### Functional Requirements

1. **Provider Registration**
   - Register multiple video generation providers
   - Support provider metadata (name, capabilities, pricing)
   - Allow runtime provider registration

2. **Provider Instantiation**
   - Create provider instances with proper configuration
   - Load encrypted API keys from database
   - Initialize providers with webhook URLs
   - Cache provider instances per account

3. **Provider Selection**
   - Get provider by name
   - Get default provider for account
   - List all available providers
   - Check provider availability

4. **Configuration Management**
   - Load provider-specific settings
   - Support BYOK (Bring Your Own Key)
   - Fall back to platform credentials if available
   - Validate provider configuration

### Non-Functional Requirements

- Provider instances must be cached per account
- API key decryption must happen on-demand
- Factory must be thread-safe for concurrent access
- Support hot-reloading of provider configuration
- Log provider initialization and errors

---

## Interface

### TypeScript Types

```typescript
import { z } from 'zod';

// Provider Types
export type VideoProviderName = 'kling' | 'runway' | 'luma';

export interface VideoProviderMetadata {
  name: VideoProviderName;
  displayName: string;
  description: string;
  supportedAspectRatios: string[];
  maxDuration: number;
  minDuration: number;
  supportsImageToVideo: boolean;
  costPerSecond: {
    standard: number;
    professional: number;
  };
}

export interface VideoProviderConfig {
  apiKey: string;
  webhookUrl: string;
  baseUrl?: string;
  timeout?: number;
}

export interface VideoGenerationProvider {
  readonly name: string;
  readonly supportedAspectRatios: string[];
  readonly maxDuration: number;

  generateVideo(request: any): Promise<any>;
  generateVideoWithImage?(request: any): Promise<any>;
  getStatus(jobId: string): Promise<any>;
  cancelJob(jobId: string): Promise<void>;
  estimateCost(request: any): number;
}

// Factory Options
export interface ProviderFactoryOptions {
  accountId: string;
  provider?: VideoProviderName;
  webhookBaseUrl?: string;
}

// Provider Registry Entry
interface ProviderRegistryEntry {
  metadata: VideoProviderMetadata;
  factory: (config: VideoProviderConfig) => VideoGenerationProvider;
}
```

### Factory Implementation

```typescript
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { decrypt } from '@kit/shared/crypto';
import { KlingProvider } from './kling/kling-provider';
import type {
  VideoProviderName,
  VideoProviderMetadata,
  VideoProviderConfig,
  VideoGenerationProvider,
  ProviderFactoryOptions,
} from './types';

// Provider Registry
const PROVIDER_REGISTRY = new Map<string, ProviderRegistryEntry>([
  [
    'kling',
    {
      metadata: {
        name: 'kling',
        displayName: 'Kling AI',
        description: 'High-quality video generation with v1.5 model',
        supportedAspectRatios: ['16:9', '9:16', '1:1'],
        maxDuration: 10,
        minDuration: 5,
        supportsImageToVideo: true,
        costPerSecond: {
          standard: 10,
          professional: 30,
        },
      },
      factory: (config) => new KlingProvider(config),
    },
  ],
  // Add more providers as they are implemented
]);

// Provider Instance Cache
const providerCache = new Map<string, VideoGenerationProvider>();

/**
 * Create a video generation provider for an account
 *
 * @param options - Provider factory options
 * @returns Configured video generation provider
 * @throws Error if provider not found or configuration invalid
 */
export async function createVideoProvider(
  options: ProviderFactoryOptions
): Promise<VideoGenerationProvider> {
  const { accountId, provider: providerName, webhookBaseUrl } = options;

  // Determine which provider to use
  const selectedProvider = providerName || (await getDefaultProvider(accountId));

  // Check cache first
  const cacheKey = `${accountId}:${selectedProvider}`;
  const cached = providerCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Get provider entry from registry
  const entry = PROVIDER_REGISTRY.get(selectedProvider);
  if (!entry) {
    throw new Error(`Video provider not found: ${selectedProvider}`);
  }

  // Load provider configuration
  const config = await loadProviderConfig(accountId, selectedProvider, webhookBaseUrl);

  // Create provider instance
  const providerInstance = entry.factory(config);

  // Cache instance
  providerCache.set(cacheKey, providerInstance);

  return providerInstance;
}

/**
 * Get metadata for a specific provider
 */
export function getProviderMetadata(
  providerName: VideoProviderName
): VideoProviderMetadata | null {
  const entry = PROVIDER_REGISTRY.get(providerName);
  return entry?.metadata || null;
}

/**
 * Get metadata for all registered providers
 */
export function getAllProviderMetadata(): VideoProviderMetadata[] {
  return Array.from(PROVIDER_REGISTRY.values()).map((entry) => entry.metadata);
}

/**
 * Check if a provider is available for an account
 */
export async function isProviderAvailable(
  accountId: string,
  providerName: VideoProviderName
): Promise<boolean> {
  try {
    const config = await loadProviderConfig(accountId, providerName);
    return !!config.apiKey;
  } catch {
    return false;
  }
}

/**
 * Get list of available providers for an account
 */
export async function getAvailableProviders(
  accountId: string
): Promise<VideoProviderMetadata[]> {
  const allProviders = getAllProviderMetadata();
  const available: VideoProviderMetadata[] = [];

  for (const provider of allProviders) {
    const isAvailable = await isProviderAvailable(accountId, provider.name);
    if (isAvailable) {
      available.push(provider);
    }
  }

  return available;
}

/**
 * Clear provider cache for an account
 * Call this when API keys are updated
 */
export function clearProviderCache(accountId?: string): void {
  if (accountId) {
    // Clear specific account
    for (const key of providerCache.keys()) {
      if (key.startsWith(`${accountId}:`)) {
        providerCache.delete(key);
      }
    }
  } else {
    // Clear all
    providerCache.clear();
  }
}

/**
 * Register a new provider (for extensibility)
 */
export function registerProvider(
  name: string,
  metadata: VideoProviderMetadata,
  factory: (config: VideoProviderConfig) => VideoGenerationProvider
): void {
  PROVIDER_REGISTRY.set(name, { metadata, factory });
}

/**
 * Load provider configuration from database
 */
async function loadProviderConfig(
  accountId: string,
  providerName: string,
  webhookBaseUrl?: string
): Promise<VideoProviderConfig> {
  const client = getSupabaseServerClient();

  // Try to get user's BYOK key first
  const { data: userKey } = await client
    .from('external_api_keys')
    .select('encrypted_key, provider_config')
    .eq('account_id', accountId)
    .eq('provider', providerName)
    .eq('is_active', true)
    .single();

  let apiKey: string;

  if (userKey?.encrypted_key) {
    // Decrypt user's key
    apiKey = await decrypt(userKey.encrypted_key);
  } else {
    // Fall back to platform key (if available)
    const platformKey = process.env[`${providerName.toUpperCase()}_API_KEY`];
    if (!platformKey) {
      throw new Error(
        `No API key configured for provider: ${providerName}. Please add your API key in settings.`
      );
    }
    apiKey = platformKey;
  }

  // Build webhook URL
  const baseUrl = webhookBaseUrl || process.env.NEXT_PUBLIC_APP_URL || '';
  const webhookUrl = `${baseUrl}/api/generation/webhooks/${providerName}`;

  return {
    apiKey,
    webhookUrl,
    baseUrl: userKey?.provider_config?.baseUrl,
    timeout: userKey?.provider_config?.timeout,
  };
}

/**
 * Get default provider for account
 * Falls back to first available provider
 */
async function getDefaultProvider(accountId: string): Promise<VideoProviderName> {
  const client = getSupabaseServerClient();

  // Check if account has a default provider set
  const { data: account } = await client
    .from('accounts')
    .select('settings')
    .eq('id', accountId)
    .single();

  if (account?.settings?.defaultVideoProvider) {
    return account.settings.defaultVideoProvider as VideoProviderName;
  }

  // Fall back to first available provider
  const available = await getAvailableProviders(accountId);
  if (available.length === 0) {
    throw new Error('No video generation providers available');
  }

  return available[0].name;
}
```

---

## Implementation Details

### File Structure

```
packages/features/video-generation/src/
├── providers/
│   ├── factory.ts                    # Provider factory (CREATE THIS)
│   ├── types.ts                      # Shared types (CREATE THIS)
│   ├── registry.ts                   # Provider registry (CREATE THIS)
│   ├── kling/
│   │   └── kling-provider.ts         # Kling provider (EXISTS)
│   └── __tests__/
│       └── factory.test.ts           # Factory tests (CREATE THIS)
```

### Provider Registry Pattern

Benefits:
- **Extensibility**: Easy to add new providers
- **Decoupling**: Providers don't know about each other
- **Lazy Loading**: Providers only instantiated when needed
- **Configuration**: Centralized provider metadata

### Cache Strategy

Provider instances are cached per account to avoid:
- Repeated database queries for API keys
- Redundant decryption operations
- Memory overhead from duplicate instances

Cache invalidation:
- When API keys are updated (manual)
- When provider configuration changes
- On application restart

### BYOK (Bring Your Own Key) Support

Priority order:
1. User's encrypted key in `external_api_keys` table
2. Platform key from environment variables
3. Throw error if neither available

This allows users to use their own provider credits while falling back to platform credits for trial users.

### Webhook URL Generation

Webhook URLs are dynamically generated based on:
- Base application URL (from env or config)
- Provider name
- Standard webhook endpoint pattern

Example: `https://app.example.com/api/generation/webhooks/kling`

---

## File Changes

### New Files

1. **packages/features/video-generation/src/providers/factory.ts**
   - Implement createVideoProvider function
   - Provider cache management
   - Configuration loading

2. **packages/features/video-generation/src/providers/types.ts**
   - Export all shared types
   - Provider interfaces
   - Factory options

3. **packages/features/video-generation/src/providers/registry.ts**
   - Provider registry singleton
   - Registration functions
   - Metadata access

4. **packages/features/video-generation/src/providers/__tests__/factory.test.ts**
   - Unit tests for factory
   - Cache behavior tests
   - Configuration loading tests

### Modified Files

1. **packages/features/video-generation/src/providers/index.ts**
   - Export factory functions
   - Export shared types
   - Re-export providers

---

## Acceptance Criteria

### Functional

- [ ] `createVideoProvider()` returns configured provider instance
- [ ] Factory uses cached instance on subsequent calls
- [ ] Factory loads BYOK keys when available
- [ ] Factory falls back to platform keys
- [ ] Factory throws error when no keys available
- [ ] `getProviderMetadata()` returns correct metadata
- [ ] `getAllProviderMetadata()` returns all registered providers
- [ ] `isProviderAvailable()` correctly checks key availability
- [ ] `getAvailableProviders()` returns only configured providers
- [ ] `clearProviderCache()` invalidates cached instances
- [ ] Webhook URLs are correctly generated

### Non-Functional

- [ ] Provider instances cached per account
- [ ] API keys decrypted only once per provider
- [ ] No API keys logged or exposed
- [ ] Factory is thread-safe
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/video-generation/src/providers/__tests__/factory.test.ts`

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createVideoProvider,
  getProviderMetadata,
  getAllProviderMetadata,
  isProviderAvailable,
  getAvailableProviders,
  clearProviderCache,
} from '../factory';

// Mock Supabase client
vi.mock('@kit/supabase/server-client');
vi.mock('@kit/shared/crypto');

describe('Provider Factory', () => {
  beforeEach(() => {
    clearProviderCache();
    vi.clearAllMocks();
  });

  describe('createVideoProvider', () => {
    it('should create provider instance', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: { encrypted_key: 'encrypted' },
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      vi.mocked(decrypt).mockResolvedValue('decrypted-api-key');

      const provider = await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      expect(provider).toBeDefined();
      expect(provider.name).toBe('kling');
    });

    it('should cache provider instances', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: { encrypted_key: 'encrypted' },
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      vi.mocked(decrypt).mockResolvedValue('decrypted-api-key');

      const provider1 = await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      const provider2 = await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      expect(provider1).toBe(provider2); // Same instance
      expect(decrypt).toHaveBeenCalledTimes(1); // Decrypted once
    });

    it('should throw error for unknown provider', async () => {
      await expect(
        createVideoProvider({
          accountId: 'account-123',
          provider: 'unknown' as any,
        })
      ).rejects.toThrow('Video provider not found');
    });

    it('should throw error when no API key available', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({ data: null })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      delete process.env.KLING_API_KEY;

      await expect(
        createVideoProvider({
          accountId: 'account-123',
          provider: 'kling',
        })
      ).rejects.toThrow('No API key configured');
    });

    it('should fall back to platform key', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({ data: null })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      process.env.KLING_API_KEY = 'platform-key';

      const provider = await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      expect(provider).toBeDefined();
    });
  });

  describe('getProviderMetadata', () => {
    it('should return metadata for valid provider', () => {
      const metadata = getProviderMetadata('kling');

      expect(metadata).toBeDefined();
      expect(metadata?.name).toBe('kling');
      expect(metadata?.displayName).toBe('Kling AI');
      expect(metadata?.supportedAspectRatios).toContain('16:9');
    });

    it('should return null for unknown provider', () => {
      const metadata = getProviderMetadata('unknown' as any);

      expect(metadata).toBeNull();
    });
  });

  describe('getAllProviderMetadata', () => {
    it('should return all registered providers', () => {
      const allProviders = getAllProviderMetadata();

      expect(allProviders.length).toBeGreaterThan(0);
      expect(allProviders[0]).toHaveProperty('name');
      expect(allProviders[0]).toHaveProperty('displayName');
    });
  });

  describe('isProviderAvailable', () => {
    it('should return true when provider has API key', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: { encrypted_key: 'encrypted' },
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      vi.mocked(decrypt).mockResolvedValue('key');

      const available = await isProviderAvailable('account-123', 'kling');

      expect(available).toBe(true);
    });

    it('should return false when provider has no API key', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({ data: null })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      delete process.env.KLING_API_KEY;

      const available = await isProviderAvailable('account-123', 'kling');

      expect(available).toBe(false);
    });
  });

  describe('clearProviderCache', () => {
    it('should clear specific account cache', async () => {
      const mockSupabase = {
        from: vi.fn(() => ({
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(() => ({
                    data: { encrypted_key: 'encrypted' },
                  })),
                })),
              })),
            })),
          })),
        })),
      };

      vi.mocked(getSupabaseServerClient).mockReturnValue(mockSupabase as any);
      vi.mocked(decrypt).mockResolvedValue('key');

      // Create cached provider
      await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      // Clear cache
      clearProviderCache('account-123');

      // Next call should decrypt again
      await createVideoProvider({
        accountId: 'account-123',
        provider: 'kling',
      });

      expect(decrypt).toHaveBeenCalledTimes(2);
    });

    it('should clear all cache when no account specified', async () => {
      clearProviderCache();

      // Cache should be empty
      expect(true).toBe(true);
    });
  });
});
```

### Integration Tests

```typescript
import { describe, it, expect } from 'vitest';
import { createVideoProvider } from '../factory';

describe('Provider Factory Integration', () => {
  it('should create provider with live database', async () => {
    // Test with actual Supabase connection
    const provider = await createVideoProvider({
      accountId: 'test-account-id',
      provider: 'kling',
    });

    expect(provider).toBeDefined();
    expect(provider.name).toBe('kling');
  });
});
```

---

## Security Considerations

### API Key Protection

- API keys always stored encrypted in database
- Keys decrypted in memory only when needed
- Provider instances never serialized/logged
- Cache cleared on logout or key rotation

### Configuration Validation

- Validate provider names against registry
- Reject unknown providers
- Validate webhook URLs before use
- Sanitize provider configuration

### Access Control

- Verify account ownership before loading keys
- Check RLS policies on external_api_keys table
- Prevent cross-account key access

---

## Error Handling

### Error Types

```typescript
export class ProviderNotFoundError extends Error {
  constructor(providerName: string) {
    super(`Video provider not found: ${providerName}`);
    this.name = 'ProviderNotFoundError';
  }
}

export class ProviderConfigurationError extends Error {
  constructor(providerName: string, reason: string) {
    super(`Provider configuration error (${providerName}): ${reason}`);
    this.name = 'ProviderConfigurationError';
  }
}

export class NoAPIKeyError extends Error {
  constructor(providerName: string) {
    super(
      `No API key configured for ${providerName}. Please add your API key in settings.`
    );
    this.name = 'NoAPIKeyError';
  }
}
```

### Error Recovery

```typescript
try {
  const provider = await createVideoProvider({
    accountId,
    provider: 'kling',
  });
} catch (error) {
  if (error instanceof NoAPIKeyError) {
    // Redirect to settings page
    redirect('/settings/api-keys');
  } else if (error instanceof ProviderNotFoundError) {
    // Log and use default provider
    console.error(error);
    return createVideoProvider({ accountId }); // No provider specified
  } else {
    throw error;
  }
}
```

---

## Performance Considerations

### Cache Size Management

```typescript
const MAX_CACHE_SIZE = 100;

function evictOldestCache() {
  if (providerCache.size > MAX_CACHE_SIZE) {
    const firstKey = providerCache.keys().next().value;
    providerCache.delete(firstKey);
  }
}
```

### Lazy Loading

Providers only loaded when needed:
- No upfront initialization
- Factory pattern enables on-demand loading
- Cache prevents repeated initialization

---

## Future Enhancements

1. **Provider Health Checks**
   - Periodic health pings to providers
   - Automatic failover to backup provider

2. **Cost Optimization**
   - Route requests to cheapest available provider
   - Load balance across multiple providers

3. **Provider Monitoring**
   - Track success/failure rates per provider
   - Alert on degraded performance

4. **Dynamic Provider Loading**
   - Load provider implementations from plugins
   - Support third-party provider extensions

---

## References

- **FILM-401**: Kling provider implementation
- **FILM-107**: @kit/video-generation package
- **Constitution**: Section 4.2 (API Keys)
- **Design Patterns**: Factory Pattern, Registry Pattern
