import 'server-only';

import { decrypt } from '@kit/shared/crypto';
import { readExternalApiKey } from '@kit/supabase/external-api-keys';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import type { ProjectAudioSettings } from '../lib/types';

/**
 * Get the account ID for a given project
 * Used to fetch API keys when only projectId is available
 */
export async function getProjectAccountId(projectId: string): Promise<string> {
  const client = getSupabaseServerClient();

  const { data, error } = await client
    .from('projects')
    .select('account_id')
    .eq('id', projectId)
    .single();

  if (error || !data?.account_id) {
    throw new Error(`Could not find project ${projectId}`);
  }

  return data.account_id;
}

/**
 * The account's active ElevenLabs key, decrypted. The one reader of it in the
 * app (KB-84): the key row is read by `readExternalApiKey`, which checks the
 * caller's account access before its admin read.
 * Throws if no API key is configured - requires explicit setup
 */
export async function getAccountElevenLabsApiKey(
  accountId: string,
): Promise<string> {
  const storedKey = await readExternalApiKey(
    getSupabaseServerClient(),
    accountId,
    'elevenlabs',
  );

  if (!storedKey?.encrypted_key) {
    throw new Error(
      'ElevenLabs API key not configured. Please add your API key in Settings → API Keys.',
    );
  }

  return await decrypt(storedKey.encrypted_key);
}

/**
 * Get ElevenLabs API key for a project (convenience function)
 * Looks up accountId from project, then fetches API key
 */
export async function getProjectElevenLabsApiKey(
  projectId: string,
): Promise<string> {
  const accountId = await getProjectAccountId(projectId);
  return getAccountElevenLabsApiKey(accountId);
}

/**
 * Fetch project audio settings from the database
 * Returns null if project not found or no settings configured
 */
export async function getProjectAudioSettings(
  projectId: string,
  client = getSupabaseServerClient(),
): Promise<ProjectAudioSettings | null> {
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
 * Throws if no model is configured - requires explicit configuration
 *
 * `client` is the caller's: the cookie session by default, the MCP
 * principal's RLS client for a render started over MCP (FILM-1909).
 */
export async function getProjectTTSModel(
  projectId: string,
  client = getSupabaseServerClient(),
): Promise<string> {
  const settings = await getProjectAudioSettings(projectId, client);
  const model = settings?.elevenlabs?.tts_model;

  if (!model) {
    throw new Error(
      `No TTS model configured for project. Please configure audio settings in Project Settings.`,
    );
  }

  return model;
}
