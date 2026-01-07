'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

/**
 * Voice type returned from ElevenLabs
 */
export interface ElevenLabsVoice {
    id: string;
    name: string;
    provider: 'elevenlabs';
    language: string;
    gender?: 'male' | 'female' | 'neutral';
    age?: string;
    accent?: string;
    description?: string;
    previewUrl?: string;
    isCloned?: boolean;
}

/**
 * Schema for fetching ElevenLabs voices
 */
const GetElevenLabsVoicesSchema = z.object({
    accountId: z.string().uuid(),
});

/**
 * Get ElevenLabs API key from stored external_api_keys
 * Throws if no API key is configured - requires explicit setup
 */
async function getAccountElevenLabsApiKey(accountId: string): Promise<string> {
    const client = getSupabaseServerClient();

    const { data: apiKeyRecord } = await client
        .from('external_api_keys')
        .select('encrypted_key')
        .eq('account_id', accountId)
        .eq('provider', 'elevenlabs')
        .eq('is_active', true)
        .single();

    if (!apiKeyRecord?.encrypted_key) {
        throw new Error(
            'ElevenLabs API key not configured. Please add your API key in Settings > API Keys.'
        );
    }

    return apiKeyRecord.encrypted_key;
}

/**
 * Fetch voices from ElevenLabs using the user's stored API key
 */
export const getElevenLabsVoicesAction = enhanceAction(
    async ({ accountId }) => {
        const apiKey = await getAccountElevenLabsApiKey(accountId);

        // Fetch voices directly from ElevenLabs API
        const response = await fetch('https://api.elevenlabs.io/v1/voices', {
            method: 'GET',
            headers: {
                'xi-api-key': apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`ElevenLabs API error: ${response.statusText}`);
        }

        interface ElevenLabsAPIVoice {
            voice_id: string;
            name: string;
            category: string;
            description?: string;
            labels: Record<string, string>;
            preview_url?: string;
        }

        const data = (await response.json()) as { voices: ElevenLabsAPIVoice[] };

        const voices: ElevenLabsVoice[] = data.voices.map((voice) => ({
            id: voice.voice_id,
            name: voice.name,
            provider: 'elevenlabs' as const,
            language: voice.labels?.accent ?? 'en',
            gender: voice.labels?.gender as 'male' | 'female' | 'neutral' | undefined,
            age: voice.labels?.age,
            accent: voice.labels?.accent,
            description: voice.description,
            previewUrl: voice.preview_url,
            isCloned: voice.category === 'cloned',
        }));

        return {
            voices,
            total: voices.length,
        };
    },
    {
        schema: GetElevenLabsVoicesSchema,
    },
);

/**
 * Schema for saving character voice assignment
 */
const AssignVoiceToCharacterSchema = z.object({
    characterId: z.string().uuid(),
    voiceAssetId: z.string().uuid().nullable(),
});

/**
 * Save voice profile assignment to a character
 */
export const assignVoiceToCharacterAction = enhanceAction(
    async ({ characterId, voiceAssetId }) => {
        const client = getSupabaseServerClient();

        // Update character_details with voice assignment
        // Note: characterId is the asset_id (PK of character_details)
        const { error } = await client
            .from('character_details')
            .update({ elevenlabs_voice_id: voiceAssetId })
            .eq('asset_id', characterId);

        if (error) {
            throw new Error(`Failed to assign voice: ${error.message}`);
        }

        return { success: true };
    },
    {
        schema: AssignVoiceToCharacterSchema,
    },
);
