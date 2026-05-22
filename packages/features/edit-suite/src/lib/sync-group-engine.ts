'use client';

/**
 * Sync Group Engine — manages dialogue variant synchronisation.
 *
 * When a clip that belongs to a sync group is moved, all other
 * clips in the same group shift by the same delta (propagation).
 *
 * Also handles auto-speed calculation: when a dubbed dialogue
 * clip has a different duration than the original, speed is
 * adjusted so it fits the original time slot.
 */
import type { DialogueSyncGroup, EditClip } from './types';

// ──────────────────────────────────────────
// Public API
// ──────────────────────────────────────────

/**
 * Calculate position deltas for all clips in the same sync group
 * when one clip moves.
 *
 * @returns Array of { clipId, startMs, endMs } updates for sibling clips
 *          (does NOT include the moved clip itself — caller handles that).
 */
export function syncGroupShift(
  movedClipId: string,
  deltaMs: number,
  clips: EditClip[],
  _syncGroups: DialogueSyncGroup[],
): Array<{ clipId: string; startMs: number; endMs: number }> {
  const movedClip = clips.find((c) => c.id === movedClipId);
  if (!movedClip?.syncGroupId) return [];

  // Find all sibling clips in the same sync group (excluding the moved one)
  const siblings = clips.filter(
    (c) => c.syncGroupId === movedClip.syncGroupId && c.id !== movedClipId,
  );

  if (siblings.length === 0) return [];

  return siblings.map((sibling) => ({
    clipId: sibling.id,
    startMs: sibling.startMs + deltaMs,
    endMs: sibling.endMs + deltaMs,
  }));
}

/**
 * Calculate auto-speed for dubbed dialogue clips.
 *
 * When a dubbed audio clip differs in duration from the original
 * (anchor), auto-speed adjusts the playback rate so it fits
 * the original time slot.
 *
 * @returns Map of clipId → recommended speed value
 */
export function autoSpeedForSyncGroup(
  syncGroupId: string,
  clips: EditClip[],
  syncGroups: DialogueSyncGroup[],
): Map<string, number> {
  const group = syncGroups.find((g) => g.id === syncGroupId);
  if (!group) return new Map();

  // Find the primary (original language) clip
  const primaryClip = clips.find((c) => c.id === group.primaryClipId);
  if (!primaryClip) return new Map();

  const originalDurationMs = primaryClip.outPointMs - primaryClip.inPointMs;
  if (originalDurationMs <= 0) return new Map();

  const speedMap = new Map<string, number>();

  // Find all dubbed clips in this sync group
  const groupClips = clips.filter(
    (c) => c.syncGroupId === syncGroupId && c.id !== group.primaryClipId,
  );

  for (const clip of groupClips) {
    const dubbedDurationMs = clip.outPointMs - clip.inPointMs;
    if (dubbedDurationMs <= 0) continue;

    // speed = dubbedDuration / originalDuration
    // If dubbed is longer, speed > 1 (plays faster to fit)
    // If dubbed is shorter, speed < 1 (plays slower to fill)
    const speed = parseFloat(
      (dubbedDurationMs / originalDurationMs).toFixed(3),
    );

    // Clamp to reasonable range
    const clampedSpeed = Math.max(0.25, Math.min(4, speed));

    if (Math.abs(clampedSpeed - 1) > 0.01) {
      speedMap.set(clip.id, clampedSpeed);
    }
  }

  return speedMap;
}

/**
 * Detect duration mismatches within a sync group.
 *
 * @returns Array of { clipId, language, durationMs, mismatchPercent }
 *          for clips that differ from the primary by > 5%.
 */
export function detectDurationMismatches(
  syncGroupId: string,
  clips: EditClip[],
  syncGroups: DialogueSyncGroup[],
): Array<{
  clipId: string;
  language: string;
  durationMs: number;
  mismatchPercent: number;
}> {
  const group = syncGroups.find((g) => g.id === syncGroupId);
  if (!group) return [];

  const primaryClip = clips.find((c) => c.id === group.primaryClipId);
  if (!primaryClip) return [];

  const originalDurationMs = primaryClip.outPointMs - primaryClip.inPointMs;
  if (originalDurationMs <= 0) return [];

  const mismatches: Array<{
    clipId: string;
    language: string;
    durationMs: number;
    mismatchPercent: number;
  }> = [];

  const groupClips = clips.filter(
    (c) => c.syncGroupId === syncGroupId && c.id !== group.primaryClipId,
  );

  for (const clip of groupClips) {
    const durationMs = clip.outPointMs - clip.inPointMs;
    const mismatchPercent =
      Math.abs((durationMs - originalDurationMs) / originalDurationMs) * 100;

    if (mismatchPercent > 5) {
      mismatches.push({
        clipId: clip.id,
        language: clip.language ?? 'unknown',
        durationMs,
        mismatchPercent: parseFloat(mismatchPercent.toFixed(1)),
      });
    }
  }

  return mismatches;
}
