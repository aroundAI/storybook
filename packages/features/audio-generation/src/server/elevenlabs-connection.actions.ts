'use server';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { ELEVENLABS } from '../lib/constants';

/**
 * ElevenLabs connection actions for testing API keys and fetching account info
 */

// Schema for testing connection
const TestConnectionSchema = z.object({
    accountId: z.string().uuid(),
    apiKey: z.string().optional(), // If not provided, will use stored key
});

// Schema for getting account info
const GetAccountInfoSchema = z.object({
    accountId: z.string().uuid(),
});

/**
 * ElevenLabs model info - fetched dynamically from API
 */
export interface ElevenLabsModelInfo {
    model_id: string;
    name: string;
    description?: string;
    can_be_finetuned?: boolean;
    can_do_text_to_speech?: boolean;
    can_do_voice_conversion?: boolean;
    can_use_style?: boolean;
    can_use_speaker_boost?: boolean;
    serves_pro_voices?: boolean;
    token_cost_factor?: number;
    concurrency_group?: string;
    max_characters_request_free_user?: number;
    max_characters_request_subscribed_user?: number;
    languages?: Array<{
        language_id: string;
        name: string;
    }>;
}

/**
 * Fallback models used when API fetch fails
 * These are kept as defaults but should not be used in production
 */
export const ELEVENLABS_FALLBACK_MODELS = [
    {
        model_id: 'eleven_multilingual_v2',
        name: 'Eleven Multilingual v2',
        description: 'High quality, 29 languages',
        can_do_text_to_speech: true,
    },
    {
        model_id: 'eleven_flash_v2_5',
        name: 'Eleven Flash v2.5',
        description: 'Ultra-fast, 32 languages',
        can_do_text_to_speech: true,
    },
    {
        model_id: 'eleven_turbo_v2_5',
        name: 'Eleven Turbo v2.5',
        description: 'Balanced quality/speed, 32 languages',
        can_do_text_to_speech: true,
    },
] as const;

// Keep old export for backward compatibility
export const ELEVENLABS_MODELS = ELEVENLABS_FALLBACK_MODELS;
export type ElevenLabsModel = ElevenLabsModelInfo;

/**
 * ElevenLabs account info response type
 */
export interface ElevenLabsAccountInfo {
    isConnected: boolean;
    subscription?: {
        tier: string;
        status: string;
    };
    characterCount?: number;
    characterLimit?: number;
    voiceCount?: number;
    voiceLimit?: number;
    canExtendCharacterLimit?: boolean;
}

/**
 * Fetch available TTS models from ElevenLabs API
 * Fetches directly from /v1/models endpoint for up-to-date model list
 */
export const getElevenLabsModelsAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        // Get stored API key
        const { data: storedKey } = await client
            .from('external_api_keys')
            .select('encrypted_key, is_active')
            .eq('account_id', data.accountId)
            .eq('provider', 'elevenlabs')
            .single();

        // If no API key, use platform key from env
        const apiKey = storedKey?.encrypted_key || process.env.ELEVENLABS_API_KEY;

        if (!apiKey) {
            // Return fallback models if no API key available
            return {
                models: ELEVENLABS_FALLBACK_MODELS.map((m) => ({
                    ...m,
                    languages: [],
                })) as ElevenLabsModelInfo[],
                fromApi: false,
            };
        }

        try {
            const response = await fetch(`${ELEVENLABS.BASE_URL}/models`, {
                method: 'GET',
                headers: {
                    'xi-api-key': apiKey,
                },
            });

            if (!response.ok) {
                console.error('[ElevenLabs] Failed to fetch models:', response.statusText);
                return {
                    models: ELEVENLABS_FALLBACK_MODELS.map((m) => ({
                        ...m,
                        languages: [],
                    })) as ElevenLabsModelInfo[],
                    fromApi: false,
                };
            }

            const allModels = (await response.json()) as ElevenLabsModelInfo[];

            // Filter to only TTS models (can_do_text_to_speech = true)
            const ttsModels = allModels.filter(
                (model) => model.can_do_text_to_speech === true,
            );

            return {
                models: ttsModels,
                fromApi: true,
            };
        } catch (error) {
            console.error('[ElevenLabs] Error fetching models:', error);
            return {
                models: ELEVENLABS_FALLBACK_MODELS.map((m) => ({
                    ...m,
                    languages: [],
                })) as ElevenLabsModelInfo[],
                fromApi: false,
            };
        }
    },
    {
        auth: true,
        schema: GetAccountInfoSchema,
    },
);

/**
 * Test ElevenLabs API key connection
 * Validates the key and returns account info
 */
export const testElevenLabsConnectionAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        // Get API key - either from input or from stored external_api_keys
        let apiKey = data.apiKey;

        if (!apiKey) {
            const { data: storedKey } = await client
                .from('external_api_keys')
                .select('encrypted_key')
                .eq('account_id', data.accountId)
                .eq('provider', 'elevenlabs')
                .eq('is_active', true)
                .single();

            if (!storedKey?.encrypted_key) {
                return {
                    success: false,
                    error: 'No API key found. Please enter your ElevenLabs API key.',
                };
            }

            apiKey = storedKey.encrypted_key;
        }

        try {
            // Test the connection by fetching user info
            const response = await fetch(`${ELEVENLABS.BASE_URL}/user`, {
                method: 'GET',
                headers: {
                    'xi-api-key': apiKey,
                },
            });

            if (!response.ok) {
                if (response.status === 401) {
                    return {
                        success: false,
                        error: 'Invalid API key. Please check your ElevenLabs API key.',
                    };
                }
                return {
                    success: false,
                    error: `ElevenLabs API error: ${response.statusText}`,
                };
            }

            interface ElevenLabsUserResponse {
                subscription: {
                    tier: string;
                    status: string;
                    character_count: number;
                    character_limit: number;
                    can_extend_character_limit: boolean;
                    voice_slots: number;
                    professional_voice_limit: number;
                };
            }

            const userData = (await response.json()) as ElevenLabsUserResponse;

            return {
                success: true,
                accountInfo: {
                    isConnected: true,
                    subscription: {
                        tier: userData.subscription.tier,
                        status: userData.subscription.status,
                    },
                    characterCount: userData.subscription.character_count,
                    characterLimit: userData.subscription.character_limit,
                    voiceCount: userData.subscription.voice_slots,
                    voiceLimit: userData.subscription.professional_voice_limit,
                    canExtendCharacterLimit:
                        userData.subscription.can_extend_character_limit,
                } as ElevenLabsAccountInfo,
            };
        } catch (error) {
            console.error('[ElevenLabs] Connection test failed:', error);
            return {
                success: false,
                error:
                    error instanceof Error
                        ? error.message
                        : 'Failed to connect to ElevenLabs',
            };
        }
    },
    {
        auth: true,
        schema: TestConnectionSchema,
    },
);

/**
 * Get ElevenLabs account info for a connected account
 */
export const getElevenLabsAccountInfoAction = enhanceAction(
    async (data) => {
        const client = getSupabaseServerClient();

        // Get stored API key
        const { data: storedKey } = await client
            .from('external_api_keys')
            .select('encrypted_key, is_active')
            .eq('account_id', data.accountId)
            .eq('provider', 'elevenlabs')
            .single();

        if (!storedKey?.encrypted_key || !storedKey.is_active) {
            return {
                isConnected: false,
            } as ElevenLabsAccountInfo;
        }

        try {
            const response = await fetch(`${ELEVENLABS.BASE_URL}/user`, {
                method: 'GET',
                headers: {
                    'xi-api-key': storedKey.encrypted_key,
                },
            });

            if (!response.ok) {
                return {
                    isConnected: false,
                } as ElevenLabsAccountInfo;
            }

            interface ElevenLabsUserResponse {
                subscription: {
                    tier: string;
                    status: string;
                    character_count: number;
                    character_limit: number;
                    can_extend_character_limit: boolean;
                    voice_slots: number;
                    professional_voice_limit: number;
                };
            }

            const userData = (await response.json()) as ElevenLabsUserResponse;

            return {
                isConnected: true,
                subscription: {
                    tier: userData.subscription.tier,
                    status: userData.subscription.status,
                },
                characterCount: userData.subscription.character_count,
                characterLimit: userData.subscription.character_limit,
                voiceCount: userData.subscription.voice_slots,
                voiceLimit: userData.subscription.professional_voice_limit,
                canExtendCharacterLimit:
                    userData.subscription.can_extend_character_limit,
            } as ElevenLabsAccountInfo;
        } catch {
            return {
                isConnected: false,
            } as ElevenLabsAccountInfo;
        }
    },
    {
        auth: true,
        schema: GetAccountInfoSchema,
    },
);

