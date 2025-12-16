import type { VideoProvider } from '../../lib/types';
import type { ShotGridShot } from '../shot-grid/types';

/**
 * Quality mode for video generation
 */
export type QualityMode = 'std' | 'pro';

/**
 * Props for the VisualStudio component
 */
export interface VisualStudioProps {
  episodeId: string;
  projectId: string;
}

/**
 * Props for the VisualStudioHeader component
 */
export interface VisualStudioHeaderProps {
  selectedShotIds: string[];
  totalShots: number;
  provider: VideoProvider;
  mode: QualityMode;
  onProviderChange: (provider: VideoProvider) => void;
  onModeChange: (mode: QualityMode) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onGenerate: () => void;
  onCopyAllPrompts?: () => void;
  isGenerating: boolean;
}

/**
 * Props for the GenerationProgress component
 */
export interface GenerationProgressProps {
  shots: ShotGridShot[];
  episodeId: string;
}

/**
 * Status returned from polling generation progress
 */
export interface ShotProgressStatus {
  shotId: string;
  generationJobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  errorMessage?: string;
  estimatedTimeRemaining?: number;
  queuePosition?: number;
}

/**
 * Provider display information
 */
export const PROVIDER_OPTIONS: Array<{
  value: VideoProvider;
  label: string;
  description: string;
}> = [
    {
      value: 'kling',
      label: 'Kling AI',
      description: 'High quality, reliable results',
    },
    {
      value: 'runway',
      label: 'Runway',
      description: 'Flexible duration options',
    },
    { value: 'luma', label: 'Luma', description: 'Fast generation' },
    { value: 'hailuo', label: 'Hailuo', description: 'Ultra-fast processing' },
  ];

/**
 * Quality mode display information
 */
export const QUALITY_OPTIONS: Array<{
  value: QualityMode;
  label: string;
  description: string;
}> = [
    { value: 'std', label: 'Standard', description: 'Faster, lower cost' },
    {
      value: 'pro',
      label: 'Professional',
      description: 'Higher quality, slower',
    },
  ];
