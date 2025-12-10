'use server';

import 'server-only';

import { decrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type {
  MusicProviderConfig,
  MusicProviderName,
  VoiceProviderConfig,
  VoiceProviderName,
} from '../lib/types';
import { NoAPIKeyError } from './errors';

/**
 * Environment variable names for platform API keys
 */
const VOICE_PLATFORM_KEY_ENV_MAP: Record<VoiceProviderName, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  playht: 'PLAYHT_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  azure: 'AZURE_TTS_API_KEY',
  google: 'GOOGLE_TTS_API_KEY',
};

const MUSIC_PLATFORM_KEY_ENV_MAP: Record<MusicProviderName, string> = {
  suno: 'SUNO_API_KEY',
  udio: 'UDIO_API_KEY',
  mubert: 'MUBERT_API_KEY',
  beatoven: 'BEATOVEN_API_KEY',
};

/**
 * Load voice provider configuration for an account
 *
 * Priority order:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 * 3. Error - if neither available
 *
 * @param accountId - The account to load configuration for
 * @param providerName - The provider to configure
 * @returns Provider configuration with decrypted API key
 * @throws NoAPIKeyError if no API key is available
 */
export async function loadVoiceProviderConfig(
  accountId: string,
  providerName: VoiceProviderName,
): Promise<VoiceProviderConfig> {
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
  let userId: string | undefined;

  if (userKey?.encrypted_key) {
    // Decrypt user's BYOK key
    apiKey = await decrypt(userKey.encrypted_key);
  } else {
    // Fall back to platform key from environment
    const envVar = VOICE_PLATFORM_KEY_ENV_MAP[providerName];
    const platformKey = process.env[envVar];

    if (!platformKey) {
      throw new NoAPIKeyError(providerName);
    }

    apiKey = platformKey;
  }

  // Get platform userId for providers that need it
  if (providerName === 'playht') {
    userId = process.env.PLAYHT_USER_ID;
  }

  return {
    apiKey,
    userId,
  };
}

/**
 * Load music provider configuration for an account
 *
 * Priority order:
 * 1. BYOK (Bring Your Own Key) - user's encrypted key from database
 * 2. Platform key - from environment variables
 * 3. Error - if neither available
 *
 * @param accountId - The account to load configuration for
 * @param providerName - The provider to configure
 * @returns Provider configuration with decrypted API key
 * @throws NoAPIKeyError if no API key is available
 */
export async function loadMusicProviderConfig(
  accountId: string,
  providerName: MusicProviderName,
): Promise<MusicProviderConfig> {
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
    const envVar = MUSIC_PLATFORM_KEY_ENV_MAP[providerName];
    const platformKey = process.env[envVar];

    if (!platformKey) {
      throw new NoAPIKeyError(providerName);
    }

    apiKey = platformKey;
  }

  return {
    apiKey,
  };
}

/**
 * Check if a voice provider has an API key configured for an account
 *
 * @param accountId - The account to check
 * @param providerName - The provider to check
 * @returns true if either BYOK or platform key is available
 */
export async function hasVoiceProviderApiKey(
  accountId: string,
  providerName: VoiceProviderName,
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
  const envVar = VOICE_PLATFORM_KEY_ENV_MAP[providerName];
  return !!process.env[envVar];
}

/**
 * Check if a music provider has an API key configured for an account
 *
 * @param accountId - The account to check
 * @param providerName - The provider to check
 * @returns true if either BYOK or platform key is available
 */
export async function hasMusicProviderApiKey(
  accountId: string,
  providerName: MusicProviderName,
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
  const envVar = MUSIC_PLATFORM_KEY_ENV_MAP[providerName];
  return !!process.env[envVar];
}
