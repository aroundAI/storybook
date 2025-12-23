'use server';

import 'server-only';

import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { PlanTimelineSchema } from '../lib/schemas';
import type { TimelinePlanResult } from '../lib/types';

// Constants for duration estimation
const WORDS_PER_MINUTE = 150;
const SECONDS_PER_WORD = 60 / WORDS_PER_MINUTE; // ~0.4s per word

/**
 * Database row types
 */
interface ShotRow {
  id: string;
  scene_number: number;
  shot_number: number;
  sequence_number: number;
  duration_seconds: number;
}

interface DialogueLineRow {
  id: string;
  text: string;
  character_asset_id: string | null;
  scene_number: number;
  sequence_number: number;
  shot_id: string | null;
}

/**
 * Estimate speaking duration from text word count
 */
function estimateDuration(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 1;
  const wordCount = text.trim().split(/\s+/).length;
  return Math.max(1, wordCount * SECONDS_PER_WORD);
}

/**
 * Group dialogue lines by scene number
 */
function groupDialogueByScene(
  dialogueLines: DialogueLineRow[],
): Record<number, DialogueLineRow[]> {
  const grouped: Record<number, DialogueLineRow[]> = {};
  for (const line of dialogueLines) {
    const sceneNum = line.scene_number;
    if (!grouped[sceneNum]) {
      grouped[sceneNum] = [];
    }
    grouped[sceneNum]!.push(line);
  }
  return grouped;
}

/**
 * Calculate dialogue offset within a shot
 * If multiple dialogues in one shot, space them evenly
 */
function calculateDialogueOffset(
  dialogueIndex: number,
  totalDialoguesInShot: number,
  shotDuration: number,
): number {
  const spacing = shotDuration / (totalDialoguesInShot + 1);
  return spacing * (dialogueIndex + 1);
}

/**
 * Timeline Planning Pass
 *
 * Runs after both screenplay and shots exist.
 * Aligns dialogue to shots and calculates timeline positions.
 *
 * Algorithm:
 * 1. Fetch all shots ordered by sequence_number
 * 2. Fetch all dialogue_lines ordered by sequence_number
 * 3. Calculate shot start times (cumulative duration)
 * 4. For each dialogue line:
 *    a. Find which shot it belongs to (by scene_number matching)
 *    b. Assign shot_id if not set
 *    c. Calculate timeline_start_seconds = shot_start + offset within shot
 *    d. Calculate estimated_duration_seconds from word count
 * 5. Update dialogue_lines with timing data
 * 6. Return timeline summary
 */
export const planTimelineAction = enhanceAction(
  async (data: { episodeId: string }): Promise<TimelinePlanResult> => {
    const logger = await getLogger();
    const ctx = {
      name: 'timeline.plan',
      episodeId: data.episodeId,
    };

    logger.info(ctx, 'Starting timeline planning');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized timeline planning attempt');
      throw new Error('Authentication required');
    }

    // 1. Fetch all shots ordered by sequence_number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: shots, error: shotsError } = await (client as any)
      .from('shots')
      .select(
        'id, scene_number, shot_number, sequence_number, duration_seconds',
      )
      .eq('episode_id', data.episodeId)
      .is('deleted_at', null)
      .order('sequence_number', { ascending: true });

    if (shotsError) {
      logger.error({ ...ctx, error: shotsError }, 'Failed to fetch shots');
      throw new Error('Failed to fetch shots for timeline planning');
    }

    const shotRows = (shots ?? []) as ShotRow[];

    if (shotRows.length === 0) {
      logger.info(ctx, 'No shots found for episode');
      return {
        episodeId: data.episodeId,
        totalDurationSeconds: 0,
        shotsProcessed: 0,
        dialogueLinesUpdated: 0,
        shots: [],
      };
    }

    // 2. Fetch all dialogue_lines ordered by sequence_number
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: dialogueLines, error: dialogueError } = await (client as any)
      .from('dialogue_lines')
      .select(
        'id, text, character_asset_id, scene_number, sequence_number, shot_id',
      )
      .eq('episode_id', data.episodeId)
      .order('sequence_number', { ascending: true });

    if (dialogueError) {
      logger.error(
        { ...ctx, error: dialogueError },
        'Failed to fetch dialogue lines',
      );
      throw new Error('Failed to fetch dialogue lines for timeline planning');
    }

    const dialogueRows = (dialogueLines ?? []) as DialogueLineRow[];
    const dialogueByScene = groupDialogueByScene(dialogueRows);

    // 3. Calculate shot start times (cumulative duration)
    // Build map of scene -> shots in that scene
    const shotsByScene: Record<number, ShotRow[]> = {};
    let cumulativeTime = 0;
    const shotStartTimes: Record<string, number> = {};

    for (const shot of shotRows) {
      shotStartTimes[shot.id] = cumulativeTime;
      cumulativeTime += shot.duration_seconds;

      if (!shotsByScene[shot.scene_number]) {
        shotsByScene[shot.scene_number] = [];
      }
      shotsByScene[shot.scene_number]!.push(shot);
    }

    const totalDuration = cumulativeTime;

    // 4. For each dialogue line, calculate timeline position
    const updates: Array<{
      id: string;
      shotId: string;
      timelineStartSeconds: number;
      estimatedDurationSeconds: number;
    }> = [];

    // Process dialogue by scene
    for (const [sceneNumStr, sceneDialogues] of Object.entries(
      dialogueByScene,
    )) {
      const sceneNum = parseInt(sceneNumStr, 10);
      const sceneShotsArr = shotsByScene[sceneNum] ?? [];

      if (sceneShotsArr.length === 0) {
        // No shots for this scene, skip dialogue timing
        logger.warn(
          { ...ctx, sceneNumber: sceneNum },
          'No shots found for scene, skipping dialogue',
        );
        continue;
      }

      // Distribute dialogue across shots in the scene
      // Strategy: Assign dialogues to shots based on their relative position in the scene
      const dialogueCount = sceneDialogues.length;
      const shotsCount = sceneShotsArr.length;

      for (let i = 0; i < dialogueCount; i++) {
        const dialogue = sceneDialogues[i]!;

        // Determine which shot this dialogue belongs to
        // If dialogue already has shot_id, use it; otherwise assign based on position
        let targetShot: ShotRow;
        if (dialogue.shot_id) {
          const existingShot = sceneShotsArr.find(
            (s) => s.id === dialogue.shot_id,
          );
          targetShot = existingShot ?? sceneShotsArr[0]!;
        } else {
          // Distribute dialogues across shots proportionally
          const shotIndex = Math.min(
            Math.floor((i / dialogueCount) * shotsCount),
            shotsCount - 1,
          );
          targetShot = sceneShotsArr[shotIndex]!;
        }

        // Calculate dialogues in this shot for offset calculation
        const dialoguesInThisShot = sceneDialogues.filter((d, idx) => {
          if (d.shot_id) {
            return d.shot_id === targetShot.id;
          }
          const assignedShotIndex = Math.min(
            Math.floor((idx / dialogueCount) * shotsCount),
            shotsCount - 1,
          );
          return sceneShotsArr[assignedShotIndex]?.id === targetShot.id;
        });

        const indexInShot = dialoguesInThisShot.findIndex(
          (d) => d.id === dialogue.id,
        );
        const shotStartTime = shotStartTimes[targetShot.id] ?? 0;
        const offset = calculateDialogueOffset(
          indexInShot,
          dialoguesInThisShot.length,
          targetShot.duration_seconds,
        );

        const timelineStartSeconds = shotStartTime + offset;
        const estimatedDurationSeconds = estimateDuration(dialogue.text);

        updates.push({
          id: dialogue.id,
          shotId: targetShot.id,
          timelineStartSeconds,
          estimatedDurationSeconds,
        });
      }
    }

    // 5. Update dialogue_lines with timing data
    let updatedCount = 0;
    for (const update of updates) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: updateError } = await (client as any)
        .from('dialogue_lines')
        .update({
          shot_id: update.shotId,
          timeline_start_seconds: update.timelineStartSeconds,
          estimated_duration_seconds: update.estimatedDurationSeconds,
        })
        .eq('id', update.id);

      if (updateError) {
        logger.warn(
          { ...ctx, dialogueId: update.id, error: updateError },
          'Failed to update dialogue line timing',
        );
      } else {
        updatedCount++;
      }
    }

    // 6. Build result
    const shotSummaries = shotRows.map((shot) => ({
      id: shot.id,
      startSeconds: shotStartTimes[shot.id] ?? 0,
      durationSeconds: shot.duration_seconds,
      dialogueCount: updates.filter((u) => u.shotId === shot.id).length,
    }));

    logger.info(
      {
        ...ctx,
        totalDuration,
        shotsProcessed: shotRows.length,
        dialogueLinesUpdated: updatedCount,
      },
      'Timeline planning completed',
    );

    return {
      episodeId: data.episodeId,
      totalDurationSeconds: totalDuration,
      shotsProcessed: shotRows.length,
      dialogueLinesUpdated: updatedCount,
      shots: shotSummaries,
    };
  },
  {
    schema: PlanTimelineSchema,
  },
);
