export const EPISODE_STATUS = {
  DRAFT: 'draft',
  PLANNING: 'planning',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  PUBLISHED: 'published',
} as const;

export const SHOT_STATUS = {
  PENDING: 'pending',
  GENERATING: 'generating',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;

export const CAMERA_ANGLES = [
  'wide',
  'medium',
  'close-up',
  'extreme-close-up',
  'over-the-shoulder',
  'pov',
  'low-angle',
  'high-angle',
  'birds-eye',
  'dutch-angle',
] as const;

export const CAMERA_MOVEMENTS = [
  'static',
  'pan',
  'tilt',
  'zoom',
  'dolly',
  'tracking',
  'crane',
  'handheld',
  'steadicam',
] as const;

export const DEFAULT_SHOT_DURATION = 5;
export const MAX_SHOTS_PER_SCENE = 100;
