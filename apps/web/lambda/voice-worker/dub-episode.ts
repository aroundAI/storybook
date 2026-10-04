/**
 * The `dub-episode` job (FILM-2007): one language of an episode, voiced
 * line by line. The translation comes from the `dialogue_translation`
 * stage (`dialogue_lines` rows in the language, keyed by
 * `source_dialogue_id`); each translated line is spoken with its speaker's
 * ElevenLabs voice on the team's own key, stored in the episode's folder,
 * and written to `dubbed_dialogue_lines` at its source line's
 * `timeline_start_seconds`, with the speed factor that fits it into the
 * source line's time. When every line is done the dubbed version is
 * `ready` and the episode is touched, so its version (and the Studio's
 * edit package etag) moves.
 *
 * A job that finds its translation not there yet asks again later (the
 * message comes back with a delay); a long episode is voiced a chunk per
 * message, each message continuing the last. Lines already voiced are
 * skipped, so a redelivered message never pays for a line twice.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DUB_LINES_PER_MESSAGE,
  DUB_MAX_WAITS,
  DUB_WAIT_SECONDS,
  type DubEpisodeMessage,
  DubEpisodeMessageSchema,
  SOURCE_DIALOGUE_LANGUAGE,
  mp3Seconds,
  timingAdjustment,
} from '@kit/audio-generation/dub-episode';
import { QueuedJobRefused } from '@kit/prompt-engine/llm-job-target';
import { dubbedDialogueAudioPath } from '@kit/storage/upload-paths';
import type { Database, Json } from '@kit/supabase/database';

type Client = SupabaseClient<Database>;

export class DubEpisodeRefused extends QueuedJobRefused {
  override readonly name = 'DubEpisodeRefused';
}

export interface DubEpisodeDeps {
  /** The account's ElevenLabs key (BYOK); throws when none is configured */
  apiKey: (accountId: string) => Promise<string>;
  /** ElevenLabs TTS: the MP3 bytes */
  speak: (request: {
    apiKey: string;
    voiceId: string;
    modelId: string;
    text: string;
    settings: { stability: number; similarityBoost: number; style?: number };
  }) => Promise<Buffer>;
  /** Stores the audio inside the job's episode; returns its URL */
  upload: (path: string, body: Buffer, episodeId: string) => Promise<string>;
  /** Sends the message back to the voice queue */
  requeue: (message: DubEpisodeMessage, delaySeconds: number) => Promise<void>;
  now?: () => Date;
}

export type DubEpisodeOutcome =
  | { status: 'waiting'; waits: number }
  | { status: 'continued'; voiced: number; remaining: number }
  | { status: 'ready'; voiced: number; failed: number; costCents: number }
  | { status: 'failed'; reason: string }
  | { status: 'skipped'; reason: string };

interface SourceLine {
  id: string;
  character_asset_id: string | null;
  text: string;
  sequence_number: number;
  timeline_start_seconds: number | null;
  estimated_duration_seconds: number | null;
  generation_metadata: Json | null;
}

interface TranslatedLine {
  id: string;
  text: string;
  source_dialogue_id: string | null;
}

interface DubbedRow {
  id: string;
  original_dialogue_id: string;
  status: string;
  audio_url: string | null;
  generation_metadata: Json | null;
}

interface VersionRow {
  id: string;
  episode_id: string;
  language: string;
  status: string;
  metadata: Json | null;
}

const OPEN_RUN = new Set(['briefed', 'in_progress']);

function record(value: Json | null | undefined): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** The voice a source line was voiced with, when its speaker has none assigned. */
function voiceOf(line: SourceLine, message: DubEpisodeMessage) {
  const assigned = line.character_asset_id
    ? message.voiceAssignments[line.character_asset_id]
    : undefined;

  if (assigned) return assigned;

  const voiced = record(line.generation_metadata).voiceId;

  return typeof voiced === 'string' && voiced ? { voiceId: voiced } : null;
}

function sourceSeconds(line: SourceLine): number | null {
  const voiced = record(line.generation_metadata).durationSeconds;

  if (typeof voiced === 'number' && voiced > 0) return voiced;

  return line.estimated_duration_seconds ?? null;
}

async function must<T>(
  query: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  what: string,
): Promise<T> {
  const { data, error } = await query;

  if (error) throw new Error(`Could not ${what}: ${error.message}`);

  return data as T;
}

export async function processDubEpisode(
  payload: unknown,
  supabase: Client,
  deps: DubEpisodeDeps,
): Promise<DubEpisodeOutcome> {
  const message = DubEpisodeMessageSchema.parse(payload);
  const now = () => (deps.now ?? (() => new Date()))();
  const log = (text: string) =>
    console.log(
      `[Dub Episode] ${message.language} ${message.dubbedVersionId.slice(0, 8)}: ${text}`,
    );

  const version = (await must(
    supabase
      .from('dubbed_versions')
      .select('id, episode_id, language, status, metadata')
      .eq('id', message.dubbedVersionId)
      .maybeSingle(),
    'read the dubbed version',
  )) as VersionRow | null;

  // The version must be the job's episode and language, or the
  // service-role writes below would land elsewhere (as KB-118 for lines)
  if (
    !version ||
    version.episode_id !== message.episodeId ||
    version.language !== message.language
  ) {
    throw new DubEpisodeRefused(
      "The dubbed version is not the job's episode and language",
    );
  }

  if (version.status === 'ready' || version.status === 'failed') {
    return { status: 'skipped', reason: `already ${version.status}` };
  }

  const metadata = record(version.metadata);
  const localization = record(metadata.localization as Json);

  const setVersion = async (
    values: Partial<Database['public']['Tables']['dubbed_versions']['Update']>,
    extra: Record<string, unknown> = {},
  ) => {
    await must(
      supabase
        .from('dubbed_versions')
        .update({
          ...values,
          metadata: {
            ...metadata,
            localization: { ...localization, ...extra },
          } as Json,
        })
        .eq('id', message.dubbedVersionId)
        .select('id'),
      'update the dubbed version',
    );
  };

  const fail = async (reason: string): Promise<DubEpisodeOutcome> => {
    await setVersion(
      {
        status: 'failed',
        ...(version.status === 'translating'
          ? { translation_status: 'failed' }
          : { voice_status: 'failed' }),
      },
      { error: reason, failedAt: now().toISOString() },
    );
    log(`failed: ${reason}`);

    return { status: 'failed', reason };
  };

  const source = (
    await must(
      supabase
        .from('dialogue_lines')
        .select(
          'id, character_asset_id, text, sequence_number, timeline_start_seconds, estimated_duration_seconds, generation_metadata',
        )
        .eq('episode_id', message.episodeId)
        .eq('language', SOURCE_DIALOGUE_LANGUAGE)
        .order('sequence_number', { ascending: true })
        .range(0, 4999),
      'read the source dialogue',
    )
  ).filter((line: SourceLine) => line.text?.trim()) as SourceLine[];

  const translations = (await must(
    supabase
      .from('dialogue_lines')
      .select('id, text, source_dialogue_id')
      .eq('episode_id', message.episodeId)
      .eq('language', message.language)
      .order('sequence_number', { ascending: true })
      .range(0, 4999),
    'read the translated dialogue',
  )) as TranslatedLine[];

  const translationOf = new Map(
    translations
      .filter((line) => line.source_dialogue_id)
      .map((line) => [line.source_dialogue_id!, line]),
  );
  const missing = source.filter((line) => !translationOf.has(line.id));

  if (missing.length > 0) {
    let runStatus: string | null = null;

    if (message.translationRunId) {
      const run = (await must(
        supabase
          .from('generation_runs')
          .select('status')
          .eq('id', message.translationRunId)
          .maybeSingle(),
        'read the translation run',
      )) as { status: string } | null;
      runStatus = run?.status ?? null;
    }

    if (runStatus && OPEN_RUN.has(runStatus)) {
      if (message.waits >= DUB_MAX_WAITS) {
        return fail(
          `The ${message.language} translation did not finish within ${(DUB_MAX_WAITS * DUB_WAIT_SECONDS) / 60} minutes`,
        );
      }

      await deps.requeue(
        { ...message, waits: message.waits + 1 },
        DUB_WAIT_SECONDS,
      );
      log(
        `waiting for translation run ${message.translationRunId} (${runStatus})`,
      );

      return { status: 'waiting', waits: message.waits + 1 };
    }

    if (translationOf.size === 0) {
      return fail(
        message.translationRunId
          ? `The translation run ended ${runStatus ?? 'missing'} without a ${message.language} translation`
          : `The dialogue has no ${message.language} translation`,
      );
    }
    // Partly translated and the run is closed: voice what there is; the
    // untranslated lines are counted as failed below
  }

  if (version.status === 'translating') {
    await setVersion(
      {
        status: 'voicing',
        translation_status: 'completed',
        voice_status: 'processing',
      },
      { translatedAt: now().toISOString() },
    );
    version.status = 'voicing';
  }

  const dubbed = (await must(
    supabase
      .from('dubbed_dialogue_lines')
      .select(
        'id, original_dialogue_id, status, audio_url, generation_metadata',
      )
      .eq('dubbed_version_id', message.dubbedVersionId)
      .range(0, 4999),
    'read the dubbed lines',
  )) as DubbedRow[];
  const done = new Map(
    dubbed
      .filter((row) => row.status === 'voiced' && row.audio_url)
      .map((row) => [row.original_dialogue_id, row]),
  );
  // A line that failed in this request is not tried again by its later
  // chunks; one that failed in an earlier request is
  const failedBefore = new Set(
    dubbed
      .filter((row) => {
        const failedAt = record(row.generation_metadata).failedAt;

        return (
          row.status === 'failed' &&
          (typeof failedAt !== 'string' || failedAt >= message.requestedAt)
        );
      })
      .map((row) => row.original_dialogue_id),
  );

  const todo = source.filter(
    (line) =>
      translationOf.has(line.id) &&
      !done.has(line.id) &&
      !failedBefore.has(line.id),
  );
  const chunk = todo.slice(0, DUB_LINES_PER_MESSAGE);
  const apiKey = chunk.length > 0 ? await deps.apiKey(message.accountId) : '';

  for (const line of chunk) {
    const translated = translationOf.get(line.id)!;
    const voice = voiceOf(line, message);
    const base = {
      dubbed_version_id: message.dubbedVersionId,
      original_dialogue_id: line.id,
      translated_text: translated.text,
      timeline_start_seconds: line.timeline_start_seconds,
    };

    if (!voice) {
      await upsertLine(supabase, {
        ...base,
        status: 'failed',
        generation_metadata: {
          error: 'The line has no speaker voice',
          failedAt: now().toISOString(),
        },
      });
      continue;
    }

    try {
      const audio = await deps.speak({
        apiKey,
        voiceId: voice.voiceId,
        modelId: message.ttsModel,
        text: translated.text,
        settings: {
          stability: voice.settings?.stability ?? 0.5,
          similarityBoost: voice.settings?.similarityBoost ?? 0.75,
          style: voice.settings?.style,
        },
      });
      const url = await deps.upload(
        dubbedDialogueAudioPath(
          message.episodeId,
          message.language,
          line.id,
          now().getTime(),
        ),
        audio,
        message.episodeId,
      );
      const seconds = mp3Seconds(audio.length);

      await upsertLine(supabase, {
        ...base,
        audio_url: url,
        duration_seconds: seconds,
        timing_adjustment: timingAdjustment(seconds, sourceSeconds(line)),
        status: 'voiced',
        generation_metadata: {
          provider: 'elevenlabs',
          method: 'per_line_tts',
          voiceId: voice.voiceId,
          model: message.ttsModel,
          translatedLineId: translated.id,
          characterCount: translated.text.length,
          // ~$0.30 per 1k characters, as the voice worker records it
          costCents: Math.ceil(translated.text.length * 0.03),
          generatedAt: now().toISOString(),
        },
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);

      // A rate limit is the queue's to retry; the message comes back whole
      if (/429|rate_limit|concurrent/.test(text)) throw error;

      await upsertLine(supabase, {
        ...base,
        status: 'failed',
        generation_metadata: { error: text, failedAt: now().toISOString() },
      });
    }
  }

  const remaining = todo.length - chunk.length;

  if (remaining > 0) {
    await deps.requeue(message, 0);
    log(`voiced ${chunk.length}, ${remaining} to go`);

    return { status: 'continued', voiced: chunk.length, remaining };
  }

  // Every line has been tried: total up, close the version, move the episode
  const final = (await must(
    supabase
      .from('dubbed_dialogue_lines')
      .select('original_dialogue_id, status, generation_metadata')
      .eq('dubbed_version_id', message.dubbedVersionId)
      .range(0, 4999),
    'read the dubbed lines',
  )) as Array<{
    original_dialogue_id: string;
    status: string;
    generation_metadata: Json | null;
  }>;
  const voiced = final.filter((row) => row.status === 'voiced');
  const failed = source.length - voiced.length;
  const costCents = voiced.reduce((sum, row) => {
    const cost = record(row.generation_metadata).costCents;
    return sum + (typeof cost === 'number' ? cost : 0);
  }, 0);

  if (voiced.length === 0) {
    return fail(`No ${message.language} line could be voiced`);
  }

  await setVersion(
    {
      status: 'ready',
      translation_status: 'completed',
      voice_status: failed > 0 ? 'failed' : 'completed',
      // Placed at each source line's start; the Studio fits them
      sync_status: 'completed',
    },
    {
      completedAt: now().toISOString(),
      voicedLines: voiced.length,
      failedLines: failed,
      costCents,
    },
  );

  // Any update moves episodes.version (its trigger): the edit package etag
  // changes and the Studio's re-sync sees the dub
  await must(
    supabase
      .from('episodes')
      .update({ updated_at: now().toISOString() })
      .eq('id', message.episodeId)
      .is('deleted_at', null)
      .select('id'),
    'touch the episode',
  );

  log(`ready: ${voiced.length} voiced, ${failed} failed, ${costCents}¢`);

  return { status: 'ready', voiced: voiced.length, failed, costCents };
}

async function upsertLine(
  supabase: Client,
  row: Database['public']['Tables']['dubbed_dialogue_lines']['Insert'],
) {
  await must(
    supabase
      .from('dubbed_dialogue_lines')
      .upsert(row, { onConflict: 'dubbed_version_id,original_dialogue_id' })
      .select('id'),
    'write the dubbed line',
  );
}
