// Shot Grid Component
export {
  ShotCard,
  ShotGrid,
  STATUS_VARIANTS,
  toShotGridShot,
  useShotSelection,
  type ShotCardProps,
  type ShotDisplayStatus,
  type ShotGridProps,
  type ShotGridShot,
} from './shot-grid';

// Generation Progress Component (standalone)
export {
  GenerationProgress as GenerationProgressStandalone,
  GenerationProgressItem,
  type GenerationProgressItemProps,
  type GenerationProgressProps as GenerationProgressStandaloneProps,
  type GenerationProgressShot,
  type ShotGenerationStatus,
} from './generation-progress';

// Visual Studio Component (includes embedded GenerationProgress)
export {
  GenerationProgress,
  PROVIDER_OPTIONS,
  QUALITY_OPTIONS,
  VisualStudio,
  VisualStudioHeader,
  type GenerationProgressProps,
  type QualityMode,
  type ShotProgressStatus,
  type VisualStudioHeaderProps,
  type VisualStudioProps,
} from './visual-studio';
