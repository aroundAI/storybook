/**
 * Audio Cue Orchestrator
 *
 * Runs the audio cue generation pipeline:
 *   1. Generate audio cues from shot data (Audio Cue Director)
 *   2. Evaluate cue quality — coverage, gaps, overlaps (Audio Cue Evaluator)
 *   3. If verdict is 'revise', regenerate with feedback (max 1 revision cycle)
 *
 * Skills:
 *   - Audio Cue Director    (generateAudioCues)    — LLM-based cue generation
 *   - Audio Cue Evaluator   (evaluateAudioCues)    — rule-based quality gate
 *
 * maxSteps: 8 — generate(1) + evaluate(1) + revise(1) + re-evaluate(1) + answer(1) + 3 buffer for validation retries
 */
import { runAgent } from '@kit/agent';
import type { AgentRunResult } from '@kit/agent';

import { audioCueDirectorSkill } from './skills/audio-cue-director-skill';
import { audioCueEvaluatorSkill } from './skills/audio-cue-evaluator-skill';

export interface AudioCueOrchestratorInput {
  episodeId: string;
  accountId: string;
  /** Pre-formatted JSON array of shots with seq, duration, audioDesc, action */
  shotsJson: string;
  totalDurationSeconds: number;
}

interface AudioCueOrchestratorOutput {
  cues: Array<{
    type: 'music' | 'sfx' | 'ambient';
    prompt: string;
    startShotSequence: number;
    startOffsetInShot: number;
    durationSeconds: number;
    reasoning?: string;
  }>;
  coveragePercent: number;
  verdict: string;
}

export interface AudioCueOrchestratorResult {
  success: boolean;
  cues: Array<{
    type: 'music' | 'sfx' | 'ambient';
    prompt: string;
    startShotSequence: number;
    startOffsetInShot: number;
    durationSeconds: number;
    reasoning?: string;
  }>;
  coveragePercent?: number;
  verdict?: string;
  orchestratorSteps: number;
  error?: string;
}

/**
 * Runs the Audio Cue Orchestrator.
 * 1. Audio Cue Director generates cues from shot data.
 * 2. Audio Cue Evaluator validates timeline coverage, gaps, and overlaps.
 * 3. If verdict is 'revise', one revision cycle is attempted.
 */
export async function runAudioCueOrchestrator(
  input: AudioCueOrchestratorInput,
): Promise<AudioCueOrchestratorResult> {
  console.log(
    `[Audio Cue Orchestrator] Starting for episode ${input.episodeId}. ` +
      `Duration: ${input.totalDurationSeconds}s`,
  );

  const result: AgentRunResult<AudioCueOrchestratorOutput> =
    await runAgent<AudioCueOrchestratorOutput>(
      {
        name: 'audio-cue-orchestrator',
        systemPrompt: AUDIO_CUE_SYSTEM_PROMPT,
        tools: [],
        skills: [audioCueDirectorSkill, audioCueEvaluatorSkill],
        maxSteps: 8,
        budgetLimits: {
          maxTotalTokens: 40_000,
          maxCostUSD: 0.6,
          maxLatencyMs: 120_000,
        },
      },
      {
        userPrompt: buildAudioCuePrompt(input),
      },
      { accountId: input.accountId },
    );

  // Log the agent result for diagnostics
  console.log(
    `[Audio Cue Orchestrator] runAgent result — success: ${result.success}, ` +
      `steps: ${result.steps.length}, error: ${result.error ?? 'none'}`,
  );

  // Log each step for visibility
  for (const [i, step] of result.steps.entries()) {
    console.log(
      `[Audio Cue Orchestrator] Step ${i + 1}: type=${step.type}, ` +
        `tool=${step.toolName ?? 'n/a'}, ` +
        `toolSuccess=${step.toolResult?.success ?? 'n/a'}, ` +
        `tokens=${step.tokensUsed ?? 0}`,
    );
  }

  if (!result.success || !result.data) {
    console.warn(`[Audio Cue Orchestrator] Failed: ${result.error}`);
    return {
      success: false,
      cues: [],
      orchestratorSteps: result.steps.length,
      error: result.error,
    };
  }

  // Extract cues from the last successful generateAudioCues step
  type GenerateAudioCuesResult = {
    cues?: Array<{
      type: 'music' | 'sfx' | 'ambient';
      prompt: string;
      startShotSequence: number;
      startOffsetInShot: number;
      durationSeconds: number;
      reasoning?: string;
    }>;
  };

  type EvaluateAudioCuesResult = {
    coveragePercent?: number;
    verdict?: string;
  };

  const cueSteps = result.steps.filter(
    (s) =>
      s.type === 'tool_call' &&
      s.toolName === 'generateAudioCues' &&
      s.toolResult?.success,
  );
  const lastCueStep = cueSteps.at(-1);
  const cueData = lastCueStep?.toolResult?.data as
    | GenerateAudioCuesResult
    | undefined;
  const cues = cueData?.cues ?? [];

  // Extract evaluation metrics from the last evaluateAudioCues step
  const evalStep = result.steps
    .filter(
      (s) =>
        s.type === 'tool_call' &&
        s.toolName === 'evaluateAudioCues' &&
        s.toolResult?.success,
    )
    .at(-1);
  const evalData = evalStep?.toolResult?.data as
    | EvaluateAudioCuesResult
    | undefined;

  if (evalData) {
    console.log(
      `[Audio Cue Orchestrator] Evaluation: coverage=${evalData.coveragePercent}%, ` +
        `verdict=${evalData.verdict}`,
    );
  } else {
    console.log(`[Audio Cue Orchestrator] Evaluation was not run or failed`);
  }

  // Log any failed tool steps
  const failedSteps = result.steps.filter(
    (s) => s.type === 'tool_call' && !s.toolResult?.success,
  );
  for (const step of failedSteps) {
    console.error(
      `[Audio Cue Orchestrator] ${step.toolName} failed: ${step.toolResult?.error ?? JSON.stringify(step.toolResult)}`,
    );
  }

  console.log(
    `[Audio Cue Orchestrator] Complete. Steps: ${result.steps.length}, ` +
      `Cues: ${cues.length}, Coverage: ${evalData?.coveragePercent ?? 'n/a'}%`,
  );

  return {
    success: true,
    cues,
    coveragePercent: evalData?.coveragePercent,
    verdict: evalData?.verdict,
    orchestratorSteps: result.steps.length,
  };
}

const AUDIO_CUE_SYSTEM_PROMPT = `You are the Audio Cue Pipeline Director.

Your job: produce a complete set of audio cues (music, SFX, ambient) that cover the entire episode timeline.

## Your Steps

1. Call generateAudioCues with all shot data to create the initial cue set.
2. Call evaluateAudioCues with the generated cues, the original shots, and the total duration.
3. If the verdict is 'revise':
   - Review the specific issues (low coverage, silent gaps, overlapping cues).
   - Call generateAudioCues again with feedback about the problem areas.
   - Call evaluateAudioCues one more time to verify the fix.
4. If the verdict is 'pass', or after one revision cycle, STOP and return the final cues.

## CRITICAL CONSTRAINTS
- Maximum 1 revision cycle — do not loop endlessly.
- Music cues should cover 60-90% of the timeline for a cinematic feel.
- SFX cues should be short and precise, aligned with action moments.
- Ambient cues fill environmental atmosphere between music transitions.
- Cues of different types CAN overlap (music + ambient is fine), but same-type overlaps are not allowed.

## Your Final Answer

Return a JSON object with:
- cues: the final array of audio cues
- coveragePercent: timeline coverage percentage from the evaluator
- verdict: 'pass' or 'revise' from the last evaluation`;

function buildAudioCuePrompt(input: AudioCueOrchestratorInput): string {
  return `Generate audio cues for this episode's shot timeline.

**Episode ID**: ${input.episodeId}
**Total Duration**: ${input.totalDurationSeconds} seconds

**Shot Data (pass to generateAudioCues as shotsJson):**
${input.shotsJson}

Start by calling generateAudioCues with the shot data above, then evaluate the result with evaluateAudioCues.`;
}
