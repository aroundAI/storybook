/**
 * The `audio_cues` stage (FILM-1901, part D): one part per scene of the
 * episode's shot list; commit inserts `audio_cues`, as
 * `handlers/audio-cue-generation.ts` did before it moved here.
 *
 * A cue belongs to the part of the scene its first shot is in, and takes
 * that shot's scene (a cue on a sceneless shot keeps no scene, KB-92).
 */
import { z } from 'zod';

import sceneAudioPrompt from '@kit/prompt-engine/prompts/audio-generation/scene-audio-refinement.json';
import {
  type AudioCueGenerationOutput,
  AudioCueGenerationOutputSchema,
} from '@kit/prompt-engine/schemas';
import { fetchAllRows } from '@kit/shared/pagination';
import { sanitizeStrings } from '@kit/shared/prompt-sanitiser';

import { type PromptFile, buildBrief } from '../brief';
import { applyCommit } from '../commit-plan';
import { jobCompletedWrite } from '../jobs';
import { registerStage } from '../registry';
import type { CheckError, Ctx, PartSpec, StageDefinition } from '../types';
import { logTo, memoPerCtx } from './memo';

export const AudioCuesTargetSchema = z.object({
  episodeId: z.string().uuid(),
  projectId: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid().optional(),
});

export type AudioCuesTarget = z.infer<typeof AudioCuesTargetSchema>;

/** The part of `shots.generation_metadata` (jsonb) this stage reads. */
interface ShotGenerationMetadata {
  veoPrompt?: { audio?: string };
  action?: string;
}

export interface ShotForCues {
  sequence_number: number;
  scene_number: number | null;
  duration_seconds: number;
  scene_description: string | null;
  prompt: string;
  generation_metadata: unknown;
}

/** A shot as the audio prompt sees it. */
export interface ShotAudioSummary {
  seq: number;
  duration: number;
  audioDesc: string;
  action: string | null;
}

export interface SceneShotGroup {
  partKey: string;
  sceneNumber: number | null;
  label: string;
  shots: ShotAudioSummary[];
  durationSeconds: number;
}

export interface AudioCuesEpisode {
  shots: ShotForCues[];
  summaries: ShotAudioSummary[];
  groups: SceneShotGroup[];
  totalDurationSeconds: number;
  /** Where each shot starts on the episode's timeline, by sequence number */
  startTimes: Map<number, number>;
  sceneOf: Map<number, number | null>;
}

export const SCENELESS_PART = 'scene:none';

export function cuePartKey(sceneNumber: number | null) {
  return sceneNumber === null ? SCENELESS_PART : `scene:${sceneNumber}`;
}

function summarise(shot: ShotForCues): ShotAudioSummary {
  const metadata = shot.generation_metadata as ShotGenerationMetadata | null;

  return {
    seq: shot.sequence_number,
    duration: shot.duration_seconds,
    audioDesc: metadata?.veoPrompt?.audio || 'No audio description',
    action: metadata?.action || shot.scene_description,
  };
}

const loaded = new WeakMap<Ctx, Map<string, Promise<AudioCuesEpisode>>>();

export function loadAudioCuesEpisode(
  ctx: Ctx,
  target: AudioCuesTarget,
): Promise<AudioCuesEpisode> {
  return memoPerCtx(loaded, ctx, target.episodeId, async () => {
    const shots = await fetchAllRows<ShotForCues>(
      (from, to) =>
        ctx.client
          .from('shots')
          .select(
            'sequence_number, scene_number, duration_seconds, scene_description, prompt, generation_metadata',
          )
          .eq('episode_id', target.episodeId)
          .is('deleted_at', null)
          .order('sequence_number', { ascending: true })
          .range(from, to),
      'shots for audio cues',
    );

    if (shots.length === 0) {
      throw new Error('Failed to fetch shots for episode: No shots found');
    }

    // Stored shot text, defused for the model (KB-101)
    const summaries = sanitizeStrings(shots.map(summarise));
    const startTimes = new Map<number, number>();
    const sceneOf = new Map<number, number | null>();
    const groups: SceneShotGroup[] = [];
    let currentTime = 0;

    shots.forEach((shot, index) => {
      startTimes.set(shot.sequence_number, currentTime);
      sceneOf.set(shot.sequence_number, shot.scene_number);
      currentTime += shot.duration_seconds;

      const partKey = cuePartKey(shot.scene_number);
      let group = groups.find((g) => g.partKey === partKey);

      if (!group) {
        group = {
          partKey,
          sceneNumber: shot.scene_number,
          label:
            shot.scene_number === null
              ? 'Shots without a scene'
              : `Scene ${shot.scene_number}`,
          shots: [],
          durationSeconds: 0,
        };
        groups.push(group);
      }

      group.shots.push(summaries[index]!);
      group.durationSeconds += shot.duration_seconds;
    });

    return {
      shots,
      summaries,
      groups,
      totalDurationSeconds: currentTime,
      startTimes,
      sceneOf,
    };
  });
}

/** `Brief.context` of every audio_cues part: what the server orchestrator needs. */
export type AudioCuesBriefContext = {
  episode: { id: string };
  scene: { number: number | null; shots: ShotAudioSummary[] };
  allShots: ShotAudioSummary[];
  totalDurationSeconds: number;
  groups: Array<{
    partKey: string;
    sceneNumber: number | null;
    shotSequences: number[];
    durationSeconds: number;
  }>;
};

function partsFor(groups: SceneShotGroup[]): PartSpec[] {
  return groups.map((group, index) => ({
    key: group.partKey,
    index,
    total: groups.length,
    label: group.label,
  }));
}

export interface AudioCueRow {
  episode_id: string;
  scene_number: number | null;
  cue_type: 'music' | 'sfx' | 'ambient';
  prompt: string;
  start_offset_seconds: number;
  duration_seconds: number;
  is_loopable: boolean;
  status: string;
}

/**
 * The rows for `audio_cues`: a cue starts where its shot starts plus its
 * offset, and takes the shot's scene. A cue on a shot the episode does not
 * have is left out, as the handler left it out (check() refuses it first).
 */
export function buildAudioCueRows(
  episode: AudioCuesEpisode,
  episodeId: string,
  cues: AudioCueGenerationOutput['cues'],
  log: (message: string) => void,
): AudioCueRow[] {
  const rows: AudioCueRow[] = [];

  for (const cue of cues) {
    const shotStart = episode.startTimes.get(cue.startShotSequence);

    if (shotStart === undefined) {
      log(
        `[Audio Generation] Cue references unknown shot sequence: ${cue.startShotSequence}`,
      );
      continue;
    }

    rows.push({
      episode_id: episodeId,
      scene_number: episode.sceneOf.get(cue.startShotSequence) ?? null,
      cue_type: cue.type,
      prompt: cue.prompt,
      start_offset_seconds: Math.max(
        0,
        shotStart + (cue.startOffsetInShot || 0),
      ),
      duration_seconds: cue.durationSeconds,
      is_loopable: cue.type === 'ambient',
      status: 'pending',
    });
  }

  return rows;
}

export const audioCuesStage: StageDefinition<
  AudioCuesTarget,
  AudioCueGenerationOutput,
  { cuesCreated: number }
> = {
  key: 'audio_cues',
  targetType: 'episode',
  targetSchema: AudioCuesTargetSchema,
  outputSchema: AudioCueGenerationOutputSchema,
  jobTracking: {
    jobType: 'audio_cue_generation',
    reference: (target) => ({ type: 'episode', id: target.episodeId }),
  },

  async parts(ctx, target) {
    const episode = await loadAudioCuesEpisode(ctx, target);

    return partsFor(episode.groups);
  },

  async prepare(ctx, target, part) {
    const episode = await loadAudioCuesEpisode(ctx, target);
    const group = episode.groups.find((g) => g.partKey === part.key);

    if (!group) {
      throw new Error(`Part ${part.key} names no scene of this shot list`);
    }

    const context: AudioCuesBriefContext = {
      episode: { id: target.episodeId },
      scene: { number: group.sceneNumber, shots: group.shots },
      allShots: episode.summaries,
      totalDurationSeconds: episode.totalDurationSeconds,
      groups: episode.groups.map((g) => ({
        partKey: g.partKey,
        sceneNumber: g.sceneNumber,
        shotSequences: g.shots.map((s) => s.seq),
        durationSeconds: g.durationSeconds,
      })),
    };

    return buildBrief({
      stage: 'audio_cues',
      part,
      prompt: sceneAudioPrompt as PromptFile,
      variables: {
        scene_heading: group.label,
        shots_json: JSON.stringify(group.shots),
      },
      context: { ...context },
      outputSchema: AudioCueGenerationOutputSchema,
      constraints: {
        shots: group.shots.map((s) => ({ seq: s.seq, duration: s.duration })),
        startShotSequence: 'one of this scene’s shot sequence numbers',
        startOffsetInShot: 'seconds from 0 to that shot’s duration',
        durationSeconds: 'greater than 0',
        sameTypeOverlap: 'not allowed; different types may overlap',
        musicCoverage: '60–90% of the timeline',
      },
      targetVersion: null,
    });
  },

  async check(ctx, target, out, part) {
    const episode = await loadAudioCuesEpisode(ctx, target);
    const group = episode.groups.find((g) => g.partKey === part.key);
    const durations = new Map(
      (group?.shots ?? []).map((s) => [s.seq, s.duration]),
    );
    const errors: CheckError[] = [];

    out.cues.forEach((cue, index) => {
      const at = `cues.${index}`;
      const shotDuration = durations.get(cue.startShotSequence);

      if (shotDuration === undefined) {
        errors.push({
          path: `${at}.startShotSequence`,
          code: 'unknown_shot',
          message: `Shot ${cue.startShotSequence} is not in ${part.label} (shots ${[...durations.keys()].join(', ')})`,
        });
      } else if (
        cue.startOffsetInShot < 0 ||
        cue.startOffsetInShot > shotDuration
      ) {
        errors.push({
          path: `${at}.startOffsetInShot`,
          code: 'offset_outside_shot',
          message: `${cue.startOffsetInShot}s is outside shot ${cue.startShotSequence}, which lasts ${shotDuration}s`,
        });
      }

      if (!(cue.durationSeconds > 0)) {
        errors.push({
          path: `${at}.durationSeconds`,
          code: 'non_positive_duration',
          message: 'A cue must last longer than 0 seconds',
        });
      }

      if (!cue.prompt.trim()) {
        errors.push({
          path: `${at}.prompt`,
          code: 'empty_prompt',
          message: 'A cue needs a generative audio prompt',
        });
      }
    });

    return errors;
  },

  async commit(ctx, run, target, outputs) {
    const log = logTo(ctx);
    const episode = await loadAudioCuesEpisode(ctx, target);
    const rows = buildAudioCueRows(
      episode,
      target.episodeId,
      outputs.flatMap((out) => out.cues),
      log,
    );

    const stamped = ctx.originColumnsAvailable
      ? rows.map(
          (row) => ({ ...row, generation_origin: run.origin }) as AudioCueRow,
        )
      : rows;

    await applyCommit(ctx, {
      ops: [
        ...(rows.length > 0
          ? [
              {
                op: 'insert' as const,
                table: 'audio_cues' as const,
                rows: stamped,
              },
            ]
          : []),
        jobCompletedWrite(target.episodeId, 'audio_cue_generation', {
          cuesCreated: rows.length,
          mode: 'agentic',
          ...run.diagnostics,
        }),
      ],
    });

    return { status: 'committed', data: { cuesCreated: rows.length } };
  },
};

registerStage(audioCuesStage);
