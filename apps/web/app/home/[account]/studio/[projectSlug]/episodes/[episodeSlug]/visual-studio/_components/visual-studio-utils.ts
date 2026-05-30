import type { ShotStatus } from '@kit/episodes/types';

export interface ShotFilter {
  sceneNumber?: number;
  status?: ShotStatus;
  searchQuery?: string;
}

// Helper to determine shot size for comic strip layout
export function getShotSize(index: number): 'lg' | 'md' | 'sm' {
  // First shot of each scene is large (spans 2 columns)
  if (index === 0) return 'lg';

  // Every 4th shot is medium
  if (index % 4 === 1) return 'md';

  // Alternate between md and sm for variety
  return index % 2 === 0 ? 'md' : 'sm';
}
