/**
 * The server-mode writers of the stages an orchestrator writes (KB-184).
 * Whatever runs server mode installs them once with the gateway's
 * `installStageWriters(STAGE_WRITERS)`; `run.write(brief)` then reaches
 * the orchestrator for these stages and the brief's prompt for the rest,
 * so a job's run and a stage-input run take one path.
 *
 * Lambda-safe: each writer imports its orchestrator lazily, on its first
 * brief, and nothing here imports `server-only` or Next.
 */
import type { StageWriter } from '@kit/ai-gateway';

import { audioCuesStageWriter } from './audio-cues';
import { dialogueTranslationStageWriter } from './dialogue-translation';
import { ideationStageWriter } from './ideation';
import { screenplayStageWriter } from './screenplay';
import { seasonOutlineStageWriter } from './season-outline';
import { shotsStageWriter } from './shots';
import { storyStageWriter } from './story';

export const STAGE_WRITERS: readonly StageWriter[] = [
  seasonOutlineStageWriter,
  ideationStageWriter,
  storyStageWriter,
  screenplayStageWriter,
  shotsStageWriter,
  audioCuesStageWriter,
  dialogueTranslationStageWriter,
];

export { cuesByPart } from './audio-cues';
export { partOutputsFrom } from './shots';
export {
  MIN_STORY_LENGTH_FOR_CANON,
  extractCanonFacts,
  type ExtractCanonFactsInput,
} from './story-canon-facts';
