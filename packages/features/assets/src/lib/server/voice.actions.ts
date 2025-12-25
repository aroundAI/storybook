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
 * Fetch voices from ElevenLabs using the user's stored API key
 */
export const getElevenLabsVoicesAction = enhanceAction(
    async ({ accountId }, _user) => {
        // First check environment variable
        let apiKey = process.env.ELEVENLABS_API_KEY;

        // Debug: log env var status
        console.log('[ElevenLabs] ELEVENLABS_API_KEY from env:', apiKey ? `${apiKey.substring(0, 10)}...` : 'NOT SET');

        // Fall back to database if no env var
        if (!apiKey) {
            const client = getSupabaseServerClient();
            const { data: apiKeyRecord } = await client
                .from('external_api_keys')
                .select('encrypted_key')
                .eq('account_id', accountId)
                .eq('provider', 'elevenlabs')
                .eq('is_active', true)
                .single();

            if (apiKeyRecord) {
                const keyRecord = apiKeyRecord as unknown as { encrypted_key: string };
                apiKey = keyRecord.encrypted_key;
            }
        }

        if (!apiKey) {
            throw new Error(
                'ElevenLabs API key not found. Set ELEVENLABS_API_KEY in env or add in Settings > API Keys.'
            );
        }

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
    async ({ characterId, voiceAssetId }, _user) => {
        const client = getSupabaseServerClient();

        // Update character_details with voice assignment
        // Note: characterId is the asset_id (PK of character_details)
        const { error } = await client
            .from('character_details')
            .update({ voice_asset_id: voiceAssetId })
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
