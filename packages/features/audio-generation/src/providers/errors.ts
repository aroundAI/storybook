import type { VoiceProviderName } from '../lib/types';

/**
 * Error thrown when a voice provider is not found in the registry
 */
export class VoiceProviderNotFoundError extends Error {
  readonly code = 'VOICE_PROVIDER_NOT_FOUND' as const;

  constructor(providerName: string) {
    super(`Voice provider not found: ${providerName}`);
    this.name = 'VoiceProviderNotFoundError';
  }
}

/**
 * Error thrown when provider configuration is invalid
 */
export class ProviderConfigurationError extends Error {
  readonly code = 'PROVIDER_CONFIGURATION_ERROR' as const;

  constructor(providerName: VoiceProviderName, reason: string) {
    super(`Provider configuration error (${providerName}): ${reason}`);
    this.name = 'ProviderConfigurationError';
  }
}

/**
 * Error thrown when no API key is available for a provider
 */
export class NoAPIKeyError extends Error {
  readonly code = 'NO_API_KEY' as const;
  readonly providerName: VoiceProviderName;

  constructor(providerName: VoiceProviderName) {
    super(
      `No API key configured for ${providerName}. Please add your API key in settings.`,
    );
    this.name = 'NoAPIKeyError';
    this.providerName = providerName;
  }
}
