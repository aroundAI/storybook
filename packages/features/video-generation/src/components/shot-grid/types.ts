import type { Shot as EpisodeShot, ShotStatus } from '@kit/episodes/types';

/**
 * Shot status for display purposes
 * Extends the base ShotStatus with 'queued' for UI display
 * when a generation job is queued but not yet processing
 */
export type ShotDisplayStatus =
  | 'pending'
  | 'queued'
  | 'generating'
  | 'completed'
  | 'failed';

/**
 * Maps the base ShotStatus to ShotDisplayStatus
 * This ensures type safety when converting between the two types
 */
function mapStatusToDisplayStatus(status: ShotStatus): ShotDisplayStatus {
  return status;
}

/**
 * Shot data as expected by the grid component
 */
export interface ShotGridShot {
  id: string;
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  prompt: string | null;
  description: string;
  duration: number;
  aspectRatio: string;
  status: ShotDisplayStatus;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  generationJobId: string | null;
  progress?: number;
  errorMessage?: string;
}

/**
 * Props for the ShotGrid component
 */
export interface ShotGridProps {
  shots: ShotGridShot[];
  selectedShotIds: string[];
  onSelectionChange: (shotIds: string[]) => void;
  onReorder?: (shotId: string, newSequence: number) => void;
  onShotPreview?: (shotId: string) => void;
  onGenerateShot?: (shotId: string) => void;
  onRetryShot?: (shotId: string) => void;
  enableReorder?: boolean;
  className?: string;
}

/**
 * Props for the ShotCard component
 */
export interface ShotCardProps {
  shot: ShotGridShot;
  isSelected: boolean;
  isDragging?: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onGenerateClick?: () => void;
  onRetryClick?: () => void;
  onCopyPrompt?: () => void;
  onEditPrompt?: () => void;
  onRegeneratePrompt?: () => void;
  onUploadVideo?: () => void;
}

/**
 * Status badge color variants - using semantic status colors
 */
export const STATUS_VARIANTS: Record<ShotDisplayStatus, string> = {
  pending: 'status-pending',
  queued: 'status-processing',
  generating: 'status-processing',
  completed: 'status-complete',
  failed: 'status-error',
};

/**
 * Convert from episodes Shot type to ShotGridShot
 */
export function toShotGridShot(shot: EpisodeShot): ShotGridShot {
  return {
    id: shot.id,
    sequenceNumber: shot.sequenceNumber ?? shot.shotNumber,
    sceneNumber: shot.sceneNumber,
    shotNumber: shot.shotNumber,
    prompt: shot.prompt,
    description: shot.description,
    duration: shot.duration,
    aspectRatio: shot.generationSettings?.aspectRatio ?? '16:9',
    status: mapStatusToDisplayStatus(shot.status),
    videoUrl: shot.videoUrl,
    thumbnailUrl: shot.thumbnailUrl,
    generationJobId: null, // Not available from EpisodeShot type
    progress: undefined,
    errorMessage: undefined,
  };
}
