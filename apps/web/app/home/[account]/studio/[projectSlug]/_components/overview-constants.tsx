import type { RecordedRate } from '@kit/clickhouse';

export interface Episode {
  id: string;
  title: string;
  number: number;
  updated_at: string;
  thumbnailUrl?: string;
  seasonNumber?: number;
  stage?:
    | 'draft'
    | 'story'
    | 'screenplay'
    | 'shots'
    | 'visual'
    | 'audio'
    | 'complete';
}

export interface ProjectMetadata {
  genre?: string;
  targetAudience?: string;
  format?: string;
  coverImageUrl?: string;
}

export interface OverviewAnalytics {
  /** Null where every published video is Facebook's: no single view (KB-153). */
  totalViews: number | null;
  /** Null where no row was read: not measured, never 0 (KB-192). */
  totalLikes: number | null;
  totalComments: number | null;
  /** Likes and comments per view (KB-171), with its record (FILM-1732). */
  /** Null where it was not measured (KB-194). */
  avgEngagementRate: RecordedRate | null;
  contentCount: number;
  seasons?: {
    seasonId: string;
    views: number;
    episodes: number;
  }[];
}

export interface ProductionStatus {
  scriptsComplete: number;
  storyboardsComplete: number;
  visualsComplete: number;
  totalEpisodes: number;
}

// Default backdrop image
export const DEFAULT_BACKDROP =
  'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';

// Gradient backgrounds for episode thumbnails
export const GRADIENTS = [
  'from-indigo-400 to-purple-600',
  'from-blue-400 to-cyan-500',
  'from-pink-400 to-rose-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
];

// Stage to progress mapping
export const STAGE_PROGRESS: Record<string, number> = {
  draft: 15,
  story: 33,
  screenplay: 50,
  shots: 66,
  visual: 75,
  audio: 90,
  complete: 100,
};

// Stage to color mapping
export const STAGE_COLORS: Record<string, { badge: string; bar: string }> = {
  draft: {
    badge:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    bar: 'bg-amber-400',
  },
  story: {
    badge:
      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800',
    bar: 'bg-amber-400',
  },
  screenplay: {
    badge:
      'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800',
    bar: 'bg-purple-500',
  },
  shots: {
    badge:
      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    bar: 'bg-blue-500',
  },
  visual: {
    badge:
      'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800',
    bar: 'bg-indigo-500',
  },
  audio: {
    badge:
      'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800',
    bar: 'bg-pink-500',
  },
  complete: {
    badge:
      'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800',
    bar: 'bg-green-500',
  },
};

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

// SVG Sparkline component
export function Sparkline({ color = '#007AFF' }: { color?: string }) {
  return (
    <svg
      className="h-full w-full overflow-visible"
      preserveAspectRatio="none"
      viewBox="0 0 100 20"
    >
      <defs>
        <linearGradient
          id={`gradient-${color.replace('#', '')}`}
          x1="0"
          x2="0"
          y1="0"
          y2="1"
        >
          <stop offset="0%" stopColor={color} stopOpacity="0.2" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d="M0 20 Q 20 18, 40 10 T 100 5 V 20 H 0"
        fill={`url(#gradient-${color.replace('#', '')})`}
        stroke="none"
      />
      <path
        d="M0 20 Q 20 18, 40 10 T 100 5"
        fill="none"
        stroke={color}
        strokeLinecap="round"
        strokeWidth="2"
      />
    </svg>
  );
}
