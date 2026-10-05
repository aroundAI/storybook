/**
 * The real I/O of the `dub-episode` job (FILM-2007): the account's own
 * ElevenLabs key and TTS endpoint, R2 inside the episode's folder, and the
 * voice queue the job continues on. Kept apart from `dub-episode.ts`, whose
 * tests drive it with stand-ins.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';

import {
  awsClientOptions,
  queueUrlFromEnv,
  vendorUrl,
} from '@kit/shared/vendors';
import type { Database } from '@kit/supabase/database';

import { uploadToR2 } from '../llm-worker/utils/r2-storage';
import type { DubEpisodeDeps } from './dub-episode';
import { getAccountElevenLabsApiKey } from './voice-generation';

let sqs: SQSClient | undefined;

/** This worker's own queue: the SST link in production, the env var locally. */
export function voiceQueueUrl(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Resource } = require('sst');
    if (Resource?.StorybookVoiceQueue?.url) {
      return Resource.StorybookVoiceQueue.url;
    }
  } catch {
    // Not in an SST environment
  }

  return queueUrlFromEnv(process.env.VOICE_QUEUE_URL) ?? '';
}

/** ElevenLabs text-to-speech, as `voice-generation.ts` calls it. */
export const speakWithElevenLabs: DubEpisodeDeps['speak'] = async (request) => {
  const response = await fetch(
    `${vendorUrl('elevenlabs')}/v1/text-to-speech/${request.voiceId}`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': request.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: request.text,
        model_id: request.modelId,
        voice_settings: {
          stability: request.settings.stability,
          similarity_boost: request.settings.similarityBoost,
          style: request.settings.style ?? 0,
          use_speaker_boost: true,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `ElevenLabs TTS API error: ${response.status} - ${await response.text()}`,
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

export function dubEpisodeDeps(
  supabase: SupabaseClient<Database>,
): DubEpisodeDeps {
  return {
    apiKey: (accountId) => getAccountElevenLabsApiKey(supabase, accountId),
    speak: speakWithElevenLabs,
    storeAudio: async (path, body, episodeId) =>
      (await uploadToR2('audio', path, body, 'audio/mpeg', { episodeId })).url,
    requeue: async (message, delaySeconds) => {
      const queueUrl = voiceQueueUrl();

      if (!queueUrl) {
        throw new Error('The voice queue URL is not configured');
      }

      sqs ??= new SQSClient(awsClientOptions('sqs'));
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
          DelaySeconds: delaySeconds,
          MessageAttributes: {
            jobType: { DataType: 'String', StringValue: 'dub-episode' },
          },
        }),
      );
    },
  };
}
