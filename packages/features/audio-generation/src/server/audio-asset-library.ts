import 'server-only';

import {
  createAudioAssetAction,
  findAudioAssetByPromptAction,
  incrementAudioAssetUsageAction,
} from './audio-asset-actions';
import type { AudioAsset } from './audio-asset-actions';

/*
 * Composes the audio-asset actions for other server code. Not in
 * `audio-asset-actions.ts`, which is `'use server'`: a plain export there
 * would be an endpoint that skips their checks (KB-58).
 */

/**
 * Find or create an audio asset
 * Returns existing asset if found, creates new one if not
 */
export async function findOrCreateAudioAsset(params: {
  projectId: string;
  audioType: 'music' | 'sfx';
  prompt: string;
  name?: string;
  provider?: string;
  metadata?: Record<string, unknown>;
}): Promise<{ asset: AudioAsset; isNew: boolean }> {
  // Try to find existing
  const existing = await findAudioAssetByPromptAction({
    projectId: params.projectId,
    prompt: params.prompt,
    audioType: params.audioType,
  });

  if (existing) {
    // Increment usage count
    await incrementAudioAssetUsageAction({ assetId: existing.id });
    return { asset: existing, isNew: false };
  }

  // Create new
  const newAsset = await createAudioAssetAction({
    projectId: params.projectId,
    audioType: params.audioType,
    prompt: params.prompt,
    name: params.name,
    provider: params.provider ?? 'elevenlabs',
    metadata: params.metadata,
  });

  return { asset: newAsset, isNew: true };
}
