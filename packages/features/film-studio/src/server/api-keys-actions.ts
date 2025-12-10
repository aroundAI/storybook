'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { decrypt, encrypt } from '@kit/shared/crypto';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  DeleteApiKeySchema,
  GetApiKeysSchema,
  SaveApiKeySchema,
  ValidateApiKeySchema,
} from '../schemas/api-keys.schema';
import type { ApiKeyInfo, ValidationResult } from '../schemas/api-keys.schema';

/**
 * Resolves account_id from account slug
 */
async function getAccountIdFromSlug(slug: string): Promise<string> {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('accounts')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    throw new Error('Account not found');
  }

  return data.id;
}

/**
 * Fetches all API keys for an account (returns masked keys)
 */
export const getApiKeysAction = enhanceAction(
  async (data): Promise<ApiKeyInfo[]> => {
    const client = getSupabaseServerClient();
    const accountId = await getAccountIdFromSlug(data.accountSlug);

    const { data: keys, error } = await client
      .from('external_api_keys')
      .select('provider, encrypted_key, is_active')
      .eq('account_id', accountId);

    if (error) {
      throw error;
    }

    // Decrypt keys to get last 4 chars (async)
    const results: ApiKeyInfo[] = [];
    for (const key of keys ?? []) {
      try {
        const decryptedKey = await decrypt(key.encrypted_key);
        results.push({
          provider: key.provider as ApiKeyInfo['provider'],
          lastFourChars: decryptedKey.slice(-4),
          isActive: key.is_active,
        });
      } catch {
        // If decryption fails, still include the key but indicate it's corrupted
        results.push({
          provider: key.provider as ApiKeyInfo['provider'],
          lastFourChars: '****',
          isActive: false,
        });
      }
    }

    return results;
  },
  {
    schema: GetApiKeysSchema,
    auth: true,
  },
);

/**
 * Saves (creates or updates) an API key for a provider
 */
export const saveApiKeyAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const accountId = await getAccountIdFromSlug(data.accountSlug);
    const encryptedKey = await encrypt(data.apiKey);

    const { error } = await client.from('external_api_keys').upsert(
      {
        account_id: accountId,
        provider: data.provider,
        encrypted_key: encryptedKey,
        is_active: true,
        last_used_at: null,
      },
      {
        onConflict: 'account_id,provider',
      },
    );

    if (error) {
      throw error;
    }

    return { success: true };
  },
  {
    schema: SaveApiKeySchema,
    auth: true,
  },
);

/**
 * Deletes an API key for a provider
 */
export const deleteApiKeyAction = enhanceAction(
  async (data) => {
    const client = getSupabaseServerClient();
    const accountId = await getAccountIdFromSlug(data.accountSlug);

    const { error } = await client
      .from('external_api_keys')
      .delete()
      .eq('account_id', accountId)
      .eq('provider', data.provider);

    if (error) {
      throw error;
    }

    return { success: true };
  },
  {
    schema: DeleteApiKeySchema,
    auth: true,
  },
);

/**
 * Validates an API key against the provider's API
 */
export const validateApiKeyAction = enhanceAction(
  async (data): Promise<ValidationResult> => {
    switch (data.provider) {
      case 'elevenlabs':
        return validateElevenLabsKey(data.apiKey);
      case 'openai':
        return validateOpenAIKey(data.apiKey);
      case 'claude':
        return validateAnthropicKey(data.apiKey);
      case 'kling':
        return validateKlingKey(data.apiKey);
      case 'runway':
        return validateRunwayKey(data.apiKey);
      case 'hailuo':
        return validateHailuoKey(data.apiKey);
      case 'gemini':
        return validateGeminiKey(data.apiKey);
      default:
        // For providers without validation endpoints, check format
        return { valid: data.apiKey.length >= 10 };
    }
  },
  {
    schema: ValidateApiKeySchema,
    auth: true,
  },
);

// Provider validation functions

async function validateElevenLabsKey(
  apiKey: string,
): Promise<ValidationResult> {
  try {
    const response = await fetch('https://api.elevenlabs.io/v1/user', {
      headers: { 'xi-api-key': apiKey },
    });
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to ElevenLabs' };
  }
}

async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to OpenAI' };
  }
}

async function validateAnthropicKey(apiKey: string): Promise<ValidationResult> {
  if (!apiKey.startsWith('sk-ant-')) {
    return { valid: false, error: 'Key should start with sk-ant-' };
  }
  // Anthropic doesn't have a simple validation endpoint
  return { valid: true };
}

async function validateKlingKey(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch('https://api.piapi.ai/api/kling/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to Kling/PiAPI' };
  }
}

async function validateRunwayKey(apiKey: string): Promise<ValidationResult> {
  if (!apiKey.startsWith('rn_')) {
    return { valid: false, error: 'Key should start with rn_' };
  }
  return { valid: true };
}

async function validateHailuoKey(apiKey: string): Promise<ValidationResult> {
  // MiniMax API validation would go here
  return { valid: apiKey.length >= 10 };
}

async function validateGeminiKey(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
    );
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to Google Gemini' };
  }
}
