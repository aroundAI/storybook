import type { PollVideoStatusResponse } from '../../lib/schemas';

/**
 * Minimum shot data needed for progress tracking.
 */
export interface GenerationProgressShot {
  id: string;
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  status: 'queued' | 'generating' | 'completed' | 'failed';
  prompt: string | null;
  generationJobId?: string;
}

/**
 * Props for the GenerationProgress component.
 */
export interface GenerationProgressProps {
  /** Array of shots to track progress for */
  shots: GenerationProgressShot[];
  /** Callback when a job is cancelled */
  onCancel?: (shotId: string) => void;
  /** Callback when a job completes */
  onComplete?: (shotId: string, videoUrl?: string) => void;
  /** Whether the component is initially collapsed */
  defaultCollapsed?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Props for individual progress item.
 */
export interface GenerationProgressItemProps {
  shot: GenerationProgressShot;
  status: PollVideoStatusResponse | null;
  isLoading: boolean;
  onCancel?: () => void;
}

/**
 * Extended status with shot reference.
 */
export interface ShotGenerationStatus {
  shotId: string;
  status: PollVideoStatusResponse | null;
  isLoading: boolean;
  error: Error | null;
}
