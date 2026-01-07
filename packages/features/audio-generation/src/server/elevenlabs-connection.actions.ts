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
 * Available ElevenLabs TTS models
 */
export const ELEVENLABS_MODELS = [
    {
        id: 'eleven_multilingual_v2',
        name: 'Multilingual v2',
        description: 'High quality, 29 languages, ~500ms latency',
        languages: 29,
        latency: 'medium',
        recommended: true,
    },
    {
        id: 'eleven_flash_v2_5',
        name: 'Flash v2.5',
        description: 'Ultra-fast, 32 languages, ~75ms latency',
        languages: 32,
        latency: 'low',
        recommended: false,
    },
    {
        id: 'eleven_turbo_v2_5',
        name: 'Turbo v2.5',
        description: 'Balanced quality/speed, 32 languages, ~250ms latency',
        languages: 32,
        latency: 'medium',
        recommended: false,
    },
    {
        id: 'eleven_monolingual_v1',
        name: 'Monolingual v1',
        description: 'English only, legacy model',
        languages: 1,
        latency: 'medium',
        recommended: false,
    },
] as const;

export type ElevenLabsModel = (typeof ELEVENLABS_MODELS)[number];

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
