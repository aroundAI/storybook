'use server';

import 'server-only';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { decrypt, encrypt } from '@kit/shared/crypto';
import { vendorUrl } from '@kit/shared/vendors';
import {
  canManageExternalApiKeys,
  readExternalApiKeys,
  removeExternalApiKey,
  storeExternalApiKey,
} from '@kit/supabase/external-api-keys';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  ApiKeyProviders,
  DeleteApiKeySchema,
  GetApiKeysSchema,
  SaveApiKeySchema,
  ValidateApiKeySchema,
} from '../api-keys.schema';
import type {
  ApiKeyProvider,
  ApiKeysOverview,
  ValidationResult,
} from '../api-keys.schema';

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

const OWNERS_ONLY = 'Only account owners can add, replace or remove API keys.';

function isKnownProvider(provider: string): provider is ApiKeyProvider {
  return ApiKeyProviders.includes(provider as ApiKeyProvider);
}

async function lastFourOf(encryptedKey: string) {
  try {
    return { lastFourChars: (await decrypt(encryptedKey)).slice(-4) };
  } catch {
    // A key that no longer decrypts is listed, as corrupted and inactive.
    return { lastFourChars: '****', corrupted: true };
  }
}

/**
 * The account's configured providers. Every role on the account sees which
 * providers are connected; only an owner, who can replace the key, sees its
 * last four characters (KB-84, owner decision 2026-09-25) — so a member's
 * list never reads the ciphertext at all.
 */
export const getApiKeysAction = enhanceAction(
  async (data): Promise<ApiKeysOverview> => {
    const client = getSupabaseServerClient();
    const accountId = await getAccountIdFromSlug(data.accountSlug);
    const canManage = await canManageExternalApiKeys(client, accountId);

    if (!canManage) {
      const { data: rows, error } = await client
        .from('external_api_keys')
        .select('provider, is_active')
        .eq('account_id', accountId)
        .order('provider');

      if (error) {
        throw error;
      }

      return {
        canManage,
        keys: rows.flatMap(({ provider, is_active }) =>
          isKnownProvider(provider)
            ? [{ provider, lastFourChars: null, isActive: is_active }]
            : [],
        ),
      };
    }

    const stored = await readExternalApiKeys(client, accountId);

    const keys = await Promise.all(
      stored.flatMap(({ provider, encrypted_key, is_active }) =>
        isKnownProvider(provider)
          ? [
              lastFourOf(encrypted_key).then(
                ({ lastFourChars, corrupted }) => ({
                  provider,
                  lastFourChars,
                  isActive: corrupted ? false : is_active,
                }),
              ),
            ]
          : [],
      ),
    );

    return { canManage, keys };
  },
  {
    schema: GetApiKeysSchema,
    auth: true,
  },
);

/**
 * Saves (creates or replaces) an API key for a provider; account owners only.
 */
export const saveApiKeyAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const accountId = await getAccountIdFromSlug(data.accountSlug);

      const { error } = await storeExternalApiKey(client, {
        account_id: accountId,
        provider: data.provider,
        encrypted_key: await encrypt(data.apiKey),
        is_active: true,
        last_used_at: null,
      });

      if (error?.branch === 'api_key_owner_check' && !error.cause) {
        throw new ActionRefusal(OWNERS_ONLY);
      }

      if (error) {
        throw new Error(`Could not save the API key (${error.branch})`, {
          cause: error.cause,
        });
      }

      return { success: true };
    },
    {
      schema: SaveApiKeySchema,
      auth: true,
    },
  ),
);

/**
 * Deletes an API key for a provider; account owners only.
 */
export const deleteApiKeyAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const accountId = await getAccountIdFromSlug(data.accountSlug);

      const { error } = await removeExternalApiKey(
        client,
        accountId,
        data.provider,
      );

      if (error?.branch === 'api_key_owner_check' && !error.cause) {
        throw new ActionRefusal(OWNERS_ONLY);
      }

      if (error) {
        throw new Error(`Could not remove the API key (${error.branch})`, {
          cause: error.cause,
        });
      }

      return { success: true };
    },
    {
      schema: DeleteApiKeySchema,
      auth: true,
    },
  ),
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
    const response = await fetch(`${vendorUrl('elevenlabs')}/v1/user`, {
      headers: { 'xi-api-key': apiKey },
    });
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to ElevenLabs' };
  }
}

async function validateOpenAIKey(apiKey: string): Promise<ValidationResult> {
  try {
    const response = await fetch(`${vendorUrl('openai')}/v1/models`, {
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
    const response = await fetch(`${vendorUrl('piapi')}/api/kling/v1/models`, {
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
      `${vendorUrl('gemini')}/v1beta/models?key=${apiKey}`,
    );
    return { valid: response.ok };
  } catch {
    return { valid: false, error: 'Failed to connect to Google Gemini' };
  }
}
