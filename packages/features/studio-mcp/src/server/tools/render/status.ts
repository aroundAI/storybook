import 'server-only';

import { z } from 'zod';

import { fetchAllByIds, fetchAllRows } from '@kit/shared/pagination';

import { McpToolError } from '../../../errors';
import { type McpToolContext, defineTool } from '../../../registry';
import { type EpisodeRef, requireEpisodeInAccount } from '../read/scope';

/** The lines or cues listed by id, beyond the counts: the ones to act on. */
const LISTED_MAX = 50;

interface LineRow {
  id: string;
  status: string;
  audio_url: string | null;
  scene_number: number | null;
  sequence_number: number;
  language: string;
}

interface CueRow {
  id: string;
  status: string;
  cue_type: string;
  scene_number: number;
  audio_track_id: string | null;
}

interface BatchRow {
  id: string;
  status: string;
  total_lines: number;
  completed_lines: number;
  failed_lines: number;
  estimated_cost: number | null;
  actual_cost: number | null;
  errors: unknown;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

type Page<T> = PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
}>;

function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts: Record<string, number> = {};

  for (const row of rows) {
    const value = key(row);
    counts[value] = (counts[value] ?? 0) + 1;
  }

  return counts;
}

type Client = McpToolContext['principal']['supabase'];

const IN_FLIGHT = new Set(['generating', 'queued', 'processing']);

interface DubbedVersionRow {
  id: string;
  language: string;
  status: string;
  translation_status: string;
  voice_status: string;
  sync_status: string;
  metadata: unknown;
  updated_at: string;
}

interface DubbedLineRow {
  dubbed_version_id: string;
  status: string;
}

interface QueuedShotRow {
  id: string;
  sequence_number: number;
  status: string;
  video_url: string | null;
  generation_metadata: unknown;
}

function field(value: unknown, key: string): unknown {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/**
 * FILM-2007's two job kinds, as the caller reads them: each dubbed
 * language (localize_episode) with its line counts, and the shots a
 * regenerate_shots run re-plans, with that run's status.
 */
async function studioJobs(client: Client, episodeId: string) {
  const versions = await fetchAllRows<DubbedVersionRow>(
    (from, to) =>
      client
        .from('dubbed_versions')
        .select(
          'id, language, status, translation_status, voice_status, sync_status, metadata, updated_at',
        )
        .eq('episode_id', episodeId)
        .order('id')
        .range(from, to) as unknown as Page<DubbedVersionRow>,
    'dubbed_versions',
  );
  const lines = await fetchAllByIds<DubbedLineRow>(
    versions.map((version) => version.id),
    (chunk, from, to) =>
      client
        .from('dubbed_dialogue_lines')
        .select('dubbed_version_id, status')
        .in('dubbed_version_id', chunk)
        .order('id')
        .range(from, to) as unknown as Page<DubbedLineRow>,
    'dubbed_dialogue_lines',
  );
  const shots = await fetchAllRows<QueuedShotRow>(
    (from, to) =>
      client
        .from('shots')
        .select('id, sequence_number, status, video_url, generation_metadata')
        .eq('episode_id', episodeId)
        .is('deleted_at', null)
        .not('generation_metadata->regeneration', 'is', null)
        .order('id')
        .range(from, to) as unknown as Page<QueuedShotRow>,
    'shots',
  );

  const runIds = [
    ...new Set(
      shots
        .map((shot) =>
          field(field(shot.generation_metadata, 'regeneration'), 'runId'),
        )
        .filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const runs = runIds.length
    ? ((
        await client
          .from('generation_runs')
          .select('id, status, mode, created_at, finalized_at')
          .in('id', runIds)
      ).data ?? [])
    : [];

  return {
    localization: versions
      .sort((a, b) => a.language.localeCompare(b.language))
      .map((version) => {
        const own = lines.filter(
          (line) => line.dubbed_version_id === version.id,
        );
        const localization = field(version.metadata, 'localization');

        return {
          kind: 'dub-episode' as const,
          dubbedVersionId: version.id,
          language: version.language,
          status: version.status,
          translationStatus: version.translation_status,
          voiceStatus: version.voice_status,
          totalLines: field(localization, 'lines') ?? null,
          linesByStatus: countBy(own, (line) => line.status),
          translationRunId: field(localization, 'translationRunId') ?? null,
          error: field(localization, 'error') ?? null,
          costCents: field(localization, 'costCents') ?? null,
          updatedAt: version.updated_at,
        };
      }),
    regeneration: runs.map((run) => {
      const own = shots.filter(
        (shot) =>
          field(field(shot.generation_metadata, 'regeneration'), 'runId') ===
          run.id,
      );

      return {
        kind: 'shot-regeneration' as const,
        runId: run.id,
        status: run.status,
        mode: run.mode,
        createdAt: run.created_at,
        finalizedAt: run.finalized_at,
        shots: own
          .sort((a, b) => a.sequence_number - b.sequence_number)
          .map((shot) => ({
            shotId: shot.id,
            status: shot.status,
            hasVideo: shot.video_url !== null,
            reason:
              field(
                field(shot.generation_metadata, 'regeneration'),
                'reason',
              ) ?? null,
          })),
      };
    }),
  };
}

function batchSummary(row: BatchRow) {
  return {
    batchJobId: row.id,
    status: row.status,
    totalLines: row.total_lines,
    completedLines: row.completed_lines,
    failedLines: row.failed_lines,
    estimatedCost: row.estimated_cost,
    actualCost: row.actual_cost,
    errors: row.errors,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

export const getRenderStatusTool = defineTool({
  name: 'get_render_progress',
  title: 'Get render status',
  description:
    "Where an episode's vendor renders and Studio jobs stand: dialogue lines by voice status (with the ids of lines still rendering or failed), audio cues by status, the voice batch (the given batchJobId, else the newest), each dubbed language from localize_episode (status, lines by status, cost) and each regenerate_shots run with its shots. Read it after start_voice_render, start_audio_render, localize_episode or regenerate_shots; they finish in the background.",
  inputSchema: {
    episodeId: z.string().uuid().describe('The episode id.'),
    batchJobId: z
      .string()
      .uuid()
      .optional()
      .describe('A batch id from start_voice_render; default the newest.'),
  },
  scope: 'studio:render',
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(input, context) {
    const client = context.principal.supabase;
    const episode = await requireEpisodeInAccount<
      EpisodeRef & { title: string }
    >(client, context.accountId, input.episodeId, 'id, title');

    const [lines, cues] = await Promise.all([
      fetchAllRows<LineRow>(
        (from, to) =>
          client
            .from('dialogue_lines')
            .select(
              'id, status, audio_url, scene_number, sequence_number, language',
            )
            .eq('episode_id', episode.id)
            .order('id')
            .range(from, to) as unknown as Page<LineRow>,
        'dialogue_lines',
      ),
      fetchAllRows<CueRow>(
        (from, to) =>
          client
            .from('audio_cues')
            .select('id, status, cue_type, scene_number, audio_track_id')
            .eq('episode_id', episode.id)
            .order('id')
            .range(from, to) as unknown as Page<CueRow>,
        'audio_cues',
      ),
    ]);

    const jobs = await studioJobs(client, episode.id);

    let batchQuery = client
      .from('batch_generation_jobs')
      .select(
        'id, status, total_lines, completed_lines, failed_lines, estimated_cost, actual_cost, errors, started_at, completed_at, created_at',
      )
      .eq('episode_id', episode.id);

    batchQuery = input.batchJobId
      ? batchQuery.eq('id', input.batchJobId)
      : batchQuery.order('created_at', { ascending: false }).limit(1);

    const { data: batches, error: batchError } = await batchQuery;

    if (batchError) {
      throw new McpToolError('INTERNAL', 'Could not read the voice batches.');
    }

    const batch = (batches as BatchRow[] | null)?.[0];

    if (input.batchJobId && !batch) {
      throw new McpToolError(
        'NOT_FOUND',
        'No voice batch with this id for the episode.',
        { details: { batchJobId: input.batchJobId } },
      );
    }

    const bySequence = (a: LineRow, b: LineRow) =>
      a.sequence_number - b.sequence_number;
    const pendingLines = lines
      .filter((line) => IN_FLIGHT.has(line.status) || line.status === 'failed')
      .sort(bySequence);
    const pendingCues = cues.filter(
      (cue) => IN_FLIGHT.has(cue.status) || cue.status === 'failed',
    );

    const voiced = lines.filter((line) => line.audio_url).length;
    const rendering =
      lines.filter((line) => IN_FLIGHT.has(line.status)).length +
      cues.filter((cue) => IN_FLIGHT.has(cue.status)).length;

    return {
      text: `"${episode.title}": ${voiced} of ${lines.length} dialogue lines voiced, ${cues.filter((cue) => cue.audio_track_id).length} of ${cues.length} cues placed, ${rendering} render(s) in flight; ${jobs.localization.length} dubbed language(s)${jobs.localization.length ? ` (${jobs.localization.map((v) => `${v.language} ${v.status}`).join(', ')})` : ''}, ${jobs.regeneration.length} shot regeneration run(s).`,
      structuredContent: {
        episodeId: episode.id,
        voice: {
          totalLines: lines.length,
          withAudio: voiced,
          byStatus: countBy(lines, (line) => line.status),
          byLanguage: countBy(lines, (line) => line.language),
          inFlightOrFailed: pendingLines.slice(0, LISTED_MAX).map((line) => ({
            id: line.id,
            status: line.status,
            sceneNumber: line.scene_number,
            sequenceNumber: line.sequence_number,
            language: line.language,
          })),
          batch: batch ? batchSummary(batch) : null,
        },
        audio: {
          totalCues: cues.length,
          placed: cues.filter((cue) => cue.audio_track_id).length,
          byStatus: countBy(cues, (cue) => cue.status),
          byType: countBy(cues, (cue) => cue.cue_type),
          inFlightOrFailed: pendingCues.slice(0, LISTED_MAX).map((cue) => ({
            id: cue.id,
            status: cue.status,
            type: cue.cue_type,
            sceneNumber: cue.scene_number,
          })),
        },
        localization: jobs.localization,
        regeneration: jobs.regeneration,
        listedMax: LISTED_MAX,
      },
    };
  },
});
