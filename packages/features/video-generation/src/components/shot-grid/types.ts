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
}

/**
 * Status badge color variants
 */
export const STATUS_VARIANTS: Record<ShotDisplayStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  generating:
    'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  completed:
    'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
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
    progress: undefined,
    errorMessage: undefined,
  };
}
