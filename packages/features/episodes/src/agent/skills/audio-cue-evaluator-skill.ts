/**
 * Audio Cue Evaluator Skill
 *
 * Rule-based quality gate for generated audio cues.
 * Validates timeline coverage, detects silent gaps and overlapping cues,
 * and checks music density — all without calling an LLM.
 *
 * Used by the Audio Cue Orchestrator as a post-generation quality gate:
 *   1. Audio Cue Director generates cues
 *   2. Audio Cue Evaluator validates them
 *   3. If verdict is 'revise', orchestrator requests targeted regeneration
 */
import { z } from 'zod';

import type { Skill } from '@kit/agent';
import { createTool, toolSuccess } from '@kit/agent';

interface GeneratedAudioCue {
  type: 'music' | 'sfx' | 'ambient';
  prompt: string;
  startShotSequence: number;
  startOffsetInShot: number;
  durationSeconds: number;
  reasoning?: string;
}

const evaluateAudioCuesTool = createTool({
  name: 'evaluateAudioCues',
  description:
    'Evaluates audio cue quality using rule-based checks: timeline coverage (≥70%), silent gaps (>3s), same-type overlaps, and music density (60-90%). Returns a pass/revise verdict with specific issues.',
  parameters: z.object({
    cuesJson: z
      .string()
      .describe(
        'JSON array of generated audio cues with type, startShotSequence, startOffsetInShot, and durationSeconds.',
      ),
    shotsJson: z
      .string()
      .describe(
        'JSON array of original shot data with seq and duration fields — used to build the absolute timeline.',
      ),
    totalDurationSeconds: z
      .number()
      .describe('Total episode duration in seconds.'),
  }),
  execute: async ({ cuesJson, shotsJson, totalDurationSeconds }) => {
    const cues = JSON.parse(cuesJson) as GeneratedAudioCue[];
    const shots = JSON.parse(shotsJson) as Array<{
      seq: number;
      duration: number;
    }>;

    console.log(
      `[Audio Cue Evaluator] Evaluating ${cues.length} cues against ` +
        `${shots.length} shots (${totalDurationSeconds}s total)`,
    );

    // Build shot start times
    const shotStartTimes = new Map<number, number>();
    let t = 0;
    for (const s of shots) {
      shotStartTimes.set(s.seq, t);
      t += s.duration;
    }

    // Calculate each cue's absolute start/end time
    const resolvedCues = cues.map((c) => {
      const shotStart = shotStartTimes.get(c.startShotSequence) ?? 0;
      return {
        ...c,
        absoluteStart: shotStart + (c.startOffsetInShot || 0),
        absoluteEnd: shotStart + (c.startOffsetInShot || 0) + c.durationSeconds,
      };
    });

    // Check coverage — which seconds have at least one cue playing
    const coveredSeconds = new Set<number>();
    for (const c of resolvedCues) {
      for (
        let s = Math.floor(c.absoluteStart);
        s < Math.ceil(c.absoluteEnd);
        s++
      ) {
        coveredSeconds.add(s);
      }
    }
    const coveragePercent = (coveredSeconds.size / totalDurationSeconds) * 100;

    // Find silent gaps > 3 seconds
    const silentGaps: Array<{
      startSec: number;
      endSec: number;
      durationSec: number;
    }> = [];
    for (let s = 0; s < totalDurationSeconds; s++) {
      if (!coveredSeconds.has(s)) {
        const gapStart = s;
        while (s < totalDurationSeconds && !coveredSeconds.has(s)) s++;
        const gapDuration = s - gapStart;
        if (gapDuration > 3) {
          silentGaps.push({
            startSec: gapStart,
            endSec: s,
            durationSec: gapDuration,
          });
        }
      }
    }

    // Check same-type overlaps
    const overlaps: Array<{ cue1: number; cue2: number }> = [];
    for (let i = 0; i < resolvedCues.length; i++) {
      for (let j = i + 1; j < resolvedCues.length; j++) {
        if (
          resolvedCues[i]!.type === resolvedCues[j]!.type &&
          resolvedCues[i]!.absoluteStart < resolvedCues[j]!.absoluteEnd &&
          resolvedCues[j]!.absoluteStart < resolvedCues[i]!.absoluteEnd
        ) {
          overlaps.push({ cue1: i, cue2: j });
        }
      }
    }

    // Music density — what % of the timeline is covered by music cues
    const musicCoverage =
      (resolvedCues
        .filter((c) => c.type === 'music')
        .reduce((sum, c) => sum + c.durationSeconds, 0) /
        totalDurationSeconds) *
      100;

    // Verdict: pass if coverage ≥70%, ≤2 silent gaps, and 0 overlaps
    const verdict =
      coveragePercent >= 70 && silentGaps.length <= 2 && overlaps.length === 0
        ? 'pass'
        : 'revise';

    const issues: string[] = [
      ...(coveragePercent < 70
        ? [`Low audio coverage: ${Math.round(coveragePercent)}% (need ≥70%)`]
        : []),
      ...(silentGaps.length > 2
        ? [`${silentGaps.length} silent gaps > 3s`]
        : []),
      ...(overlaps.length > 0
        ? [`${overlaps.length} overlapping same-type cues`]
        : []),
    ];

    console.log(
      `[Audio Cue Evaluator] Verdict: ${verdict} — ` +
        `coverage: ${Math.round(coveragePercent)}%, ` +
        `gaps: ${silentGaps.length}, overlaps: ${overlaps.length}, ` +
        `musicCoverage: ${Math.round(musicCoverage)}%`,
    );

    return toolSuccess({
      coveragePercent: Math.round(coveragePercent),
      silentGaps,
      overlaps,
      musicCoveragePercent: Math.round(musicCoverage),
      verdict,
      issues,
    });
  },

  // OPT-2: Keep metrics and verdict, drop per-gap and per-overlap details
  summarizeResult: (result) => {
    if (!result.success || !result.data) return result;
    const d = result.data as Record<string, unknown>;
    const gaps = d.silentGaps as Array<unknown> | undefined;
    const ovlps = d.overlaps as Array<unknown> | undefined;
    return {
      success: true,
      coveragePercent: d.coveragePercent,
      silentGapCount: gaps?.length ?? 0,
      overlapCount: ovlps?.length ?? 0,
      musicCoveragePercent: d.musicCoveragePercent,
      verdict: d.verdict,
    };
  },
});

export const audioCueEvaluatorSkill: Skill = {
  name: 'audio-cue-evaluator',
  description:
    'Validates audio cue timeline coverage (≥70%), identifies silent gaps >3s and same-type overlaps, and checks music density. Returns a pass/revise verdict with specific issues.',
  tools: [evaluateAudioCuesTool],
  contextPrompt: `You have access to an Audio Cue Evaluator that performs rule-based quality checks on generated cues:

- **Timeline coverage**: What percentage of total duration is covered by at least one cue (target: ≥70%)
- **Silent gaps**: Gaps longer than 3 seconds with no audio cue playing
- **Same-type overlaps**: Two cues of the same type (e.g. two music cues) playing simultaneously
- **Music density**: Music cues should cover 60-90% of the timeline for cinematic feel

Verdict thresholds:
- 'pass': coverage ≥70%, ≤2 silent gaps, 0 same-type overlaps
- 'revise': any threshold violated — regenerate cues targeting the specific issues`,
  instructions: `1. Call evaluateAudioCues after cue generation completes
2. If verdict is 'revise', regenerate cues with generateAudioCues targeting the specific issue areas
3. Include coveragePercent, musicCoveragePercent, and verdict in the final answer`,
};
