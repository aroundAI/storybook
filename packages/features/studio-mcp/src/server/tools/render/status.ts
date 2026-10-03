import 'server-only';

import { z } from 'zod';

import { fetchAllRows } from '@kit/shared/pagination';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
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

const IN_FLIGHT = new Set(['generating', 'queued', 'processing']);

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
  name: 'get_render_status',
  title: 'Get render status',
  description:
    "Where an episode's vendor renders stand: dialogue lines by voice status (with the ids of lines still rendering or failed), audio cues by status, and the voice batch (the given batchJobId, else the newest). Read it after start_voice_render or start_audio_render; renders finish in the background.",
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
      text: `"${episode.title}": ${voiced} of ${lines.length} dialogue lines voiced, ${cues.filter((cue) => cue.audio_track_id).length} of ${cues.length} cues placed, ${rendering} render(s) in flight.`,
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
        listedMax: LISTED_MAX,
      },
    };
  },
});
