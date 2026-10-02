// Episode components

// Episode Tabs (FILM-901)
export { EpisodeTabs } from './episode-tabs';

// Duration Selector
export { DurationSelector, DurationBadge } from './duration-selector';

// Screenplay Viewer (FILM-310)
export { ScreenplayViewer } from './screenplay-viewer/screenplay-viewer';
export { SceneContent } from './screenplay-viewer/scene-content';
export { SceneNavigation } from './screenplay-viewer/scene-navigation';

// Batch Episode Creator (FILM-314)
export { BatchEpisodeCreator } from './batch-episode-creator/batch-episode-creator';
export { EpisodePreviewDialog } from './batch-episode-creator/episode-preview-dialog';

// Video Upload
export { VideoUploader, type VideoUploaderProps } from './video-uploader';

// Fact Management (Phase 11: FILM-1121)
export {
  FactCard,
  FactLibrary,
  AddFactForm,
  FactVerificationDialog,
} from './facts';
export type { MappedFact } from './facts';
export {
  STATUS_STYLES,
  STATUS_LABELS,
  STATUS_OPTIONS,
  FACT_CATEGORIES,
  CATEGORY_OPTIONS,
  SOURCE_TYPES,
} from './facts';

// Refinement Chat (Feature 2: Chat-Based Refinement)
export { RefinementChat } from './refinement-chat';

// Sidebar Asset List (linked/unlinked indicators + create from sidebar)
export { SidebarAssetList } from './sidebar-asset-list';
