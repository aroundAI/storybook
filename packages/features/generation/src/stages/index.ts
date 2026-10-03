/**
 * Importing this module registers every stage. Each stage file calls
 * `registerStage` at load; `@kit/generation` re-exports them, so a caller
 * that imports the package sees the registry filled. The package is
 * `sideEffects: false`, so a bundler drops a stage module whose exports
 * nobody uses, registration and all: `ALL_STAGES` is the list the run
 * layer reads, which keeps every stage in any bundle that runs a stage.
 */
import { assetDescriptionStage } from './asset-description';
import { audioCuesStage } from './audio-cues';
import { dialogueTranslationStage } from './dialogue-translation';
import { episodeSummaryStage } from './episode-summary';
import { factExtractionStage } from './fact-extraction';
import { ideationStage } from './ideation';
import { publishMetadataStage } from './publish-metadata';
import { screenplayStage } from './screenplay';
import { screenplayRefinementStage } from './screenplay-refinement';
import { seasonAnalysisStage } from './season-analysis';
import { seasonOutlineStage } from './season-outline';
import { shotsStage } from './shots';
import { storyStage } from './story';
import { storyRefinementStage } from './story-refinement';

export {
  StoryRefinementOutputSchema,
  StoryRefinementTargetSchema,
  storyRefinementStage,
  type StoryRefinementData,
  type StoryRefinementOutput,
  type StoryRefinementTarget,
} from './story-refinement';
export {
  ASSET_DESCRIPTION_CONTEXT_CHARS,
  AssetDescriptionOutputSchema,
  AssetDescriptionTargetSchema,
  CHARACTER_INSTRUCTIONS,
  LOCATION_INSTRUCTIONS,
  assetDescriptionStage,
  fallbackDescription,
  type AssetDescriptionData,
  type AssetDescriptionOutput,
  type AssetDescriptionTarget,
} from './asset-description';
export * from './shared/dialogue-lines';
export * from './shared/character-arcs';
export * from './shared/scene-checks';
export * from './screenplay';
export * from './screenplay-refinement';
export * from './dialogue-translation';
export * from './publish-metadata';
export * from './story';
export * from './ideation';
export * from './season-outline';
export * from './season-analysis';
export * from './shots';
export * from './audio-cues';
export * from './fact-extraction';
export * from './episode-summary';

/** Every stage definition; reading it loads every stage module. */
export const ALL_STAGES = [
  seasonOutlineStage,
  ideationStage,
  storyStage,
  storyRefinementStage,
  screenplayStage,
  screenplayRefinementStage,
  shotsStage,
  audioCuesStage,
  dialogueTranslationStage,
  assetDescriptionStage,
  publishMetadataStage,
  seasonAnalysisStage,
  factExtractionStage,
  episodeSummaryStage,
] as const;
