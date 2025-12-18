// Episode components

// UI Components
export { MaterialIcon, GlassCard, GlassPanel } from './ui';
export type { MaterialIconProps, GlassCardProps } from './ui';

// Episode Tabs (FILM-901)
export { EpisodeTabs } from './episode-tabs';

// Continuity Checker (FILM-313)
export { ContinuityChecker } from './continuity-checker';

// Story Studio (FILM-308)
export { StoryStudio } from './story-studio/story-studio';
export { PipelineProgress } from './story-studio/pipeline-progress';
export {
  useStoryStudioContext,
  StoryStudioContext,
} from './story-studio/story-studio-context';

// Story Ideation (FILM-309)
export {
  StoryIdeation,
  type StoryIdeaWithSettings,
} from './story-ideation/story-ideation';
export { IdeaCard } from './story-ideation/idea-card';

// Duration Selector
export { DurationSelector, DurationBadge } from './duration-selector';

// Screenplay Viewer (FILM-310)
export { ScreenplayViewer } from './screenplay-viewer/screenplay-viewer';
export { SceneContent } from './screenplay-viewer/scene-content';
export { SceneNavigation } from './screenplay-viewer/scene-navigation';

// Shot List Editor (FILM-311)
export { ShotListEditor } from './shot-list-editor/shot-list-editor';
export { ShotRow } from './shot-list-editor/shot-row';
export { ShotCard, AddShotCard } from './shot-list-editor/shot-card';
export { ShotDetailsPanel } from './shot-list-editor/shot-details-panel';

// Batch Episode Creator (FILM-314)
export { BatchEpisodeCreator } from './batch-episode-creator/batch-episode-creator';
export { EpisodePreviewDialog } from './batch-episode-creator/episode-preview-dialog';

// Timeline Editor (FILM-601)
export { TimelineEditor, useTimelineContext } from './timeline-editor';
export type {
  TimelineEditorProps,
  TimelineData,
  TimelineClip,
  TimelineTrack,
  ClipType,
} from './timeline-editor';

// Audio Studio
export { AudioStudio } from './audio-studio/audio-studio';
export { VoiceAssignmentPanel } from './audio-studio/voice-assignment-panel';
export { AudioTimeline } from './audio-studio/audio-timeline';
export type { AudioStudioProps } from './audio-studio/audio-studio';
export type {
  Character,
  VoiceAssignmentPanelProps,
} from './audio-studio/voice-assignment-panel';
export type {
  DialogueBlock,
  AudioTimelineProps,
} from './audio-studio/audio-timeline';
