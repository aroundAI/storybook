'use server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { ProjectAudioSettings } from '../lib/types';

/**
 * Fetch project audio settings from the database
 * Returns null if project not found or no settings configured
 */
export async function getProjectAudioSettings(
    projectId: string,
): Promise<ProjectAudioSettings | null> {
    const client = getSupabaseServerClient();

    const { data, error } = await client
        .from('projects')
        .select('audio_settings')
        .eq('id', projectId)
        .single();

    if (error || !data?.audio_settings) {
        return null;
    }

    return data.audio_settings as ProjectAudioSettings;
}

/**
 * Get the ElevenLabs TTS model for a project
 * Returns default model if no project settings
 */
export async function getProjectTTSModel(
    projectId: string,
): Promise<string> {
    const settings = await getProjectAudioSettings(projectId);
    return settings?.elevenlabs?.tts_model || 'eleven_multilingual_v2';
}

/**
 * Get the ElevenLabs SFX model for a project
 * Returns default model if no project settings
 */
export async function getProjectSFXModel(
    projectId: string,
): Promise<string> {
    const settings = await getProjectAudioSettings(projectId);
    return settings?.elevenlabs?.sfx_model || 'eleven_multilingual_v2';
}
