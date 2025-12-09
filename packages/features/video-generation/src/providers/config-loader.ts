'use server';

import 'server-only';

import { decrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { NoAPIKeyError } from './errors';
import type { VideoProviderConfig, VideoProviderName } from './types';

/**
 * Environment variable names for platform API keys
 */
const PLATFORM_KEY_ENV_MAP: Record<VideoProviderName, string> = {
  kling: 'KLING_API_KEY',
  runway: 'RUNWAY_API_KEY',
  hailuo: 'HAILUO_API_KEY',
  luma: 'LUMA_API_KEY',
};

/**
 * Load provider configuration for an account
 *
 * Priority order:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 * 3. Error - if neither available
 *
 * @param accountId - The account to load configuration for
 * @param providerName - The provider to configure
 * @param webhookBaseUrl - Optional base URL for webhooks (defaults to NEXT_PUBLIC_SITE_URL)
 * @returns Provider configuration with decrypted API key
 * @throws NoAPIKeyError if no API key is available
 */
export async function loadProviderConfig(
  accountId: string,
  providerName: VideoProviderName,
  webhookBaseUrl?: string,
): Promise<VideoProviderConfig> {
  const client = getSupabaseServerClient();

  // Try to get user's BYOK key first
  const { data: userKey } = await client
    .from('external_api_keys')
    .select('encrypted_key')
    .eq('account_id', accountId)
    .eq('provider', providerName)
    .eq('is_active', true)
    .single();

  let apiKey: string;

  if (userKey?.encrypted_key) {
    // Decrypt user's BYOK key
    apiKey = await decrypt(userKey.encrypted_key);
  } else {
    // Fall back to platform key from environment
    const envVar = PLATFORM_KEY_ENV_MAP[providerName];
    const platformKey = process.env[envVar];

    if (!platformKey) {
      throw new NoAPIKeyError(providerName);
    }

    apiKey = platformKey;
  }

  // Build webhook URL
  const baseUrl = webhookBaseUrl ?? process.env.NEXT_PUBLIC_SITE_URL ?? '';
  const webhookUrl = `${baseUrl}/api/generation/webhooks/${providerName}`;

  return {
    apiKey,
    webhookUrl,
  };
}

/**
 * Check if a provider has an API key configured for an account
 *
 * @param accountId - The account to check
 * @param providerName - The provider to check
 * @returns true if either BYOK or platform key is available
 */
export async function hasProviderApiKey(
  accountId: string,
  providerName: VideoProviderName,
): Promise<boolean> {
  const client = getSupabaseServerClient();

  // Check for BYOK key
  const { data: userKey } = await client
    .from('external_api_keys')
    .select('id')
    .eq('account_id', accountId)
    .eq('provider', providerName)
    .eq('is_active', true)
    .single();

  if (userKey) {
    return true;
  }

  // Check for platform key
  const envVar = PLATFORM_KEY_ENV_MAP[providerName];
  return !!process.env[envVar];
}
