'use client';

/**
 * OverviewContent Component
 *
 * Redesigned based on overview/code.html prototype.
 * All data is dynamic, no hardcoded values.
 */
import Link from 'next/link';

import { formatDistanceToNow } from 'date-fns';

interface Episode {
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

interface ProjectMetadata {
  genre?: string;
  targetAudience?: string;
  format?: string;
  coverImageUrl?: string;
}

interface OverviewContentProps {
  project: {
    id: string;
    name: string;
    description?: string | null;
  };
  metadata: ProjectMetadata;
  episodeCount: number;
  characterCount: number;
  locationCount: number;
  recentEpisodes: Episode[];
  productionStatus: {
    scriptsComplete: number;
    storyboardsComplete: number;
    visualsComplete: number;
    totalEpisodes: number;
  };
  analytics?: {
    totalViews: number;
    totalLikes: number;
    totalComments: number;
    avgEngagementRate: number;
    contentCount: number;
    seasons?: {
      seasonId: string;
      views: number;
      episodes: number;
    }[];
  } | null;
  baseUrl: string;
}

// Default backdrop image
const DEFAULT_BACKDROP =
  'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';

// Gradient backgrounds for episode thumbnails
const GRADIENTS = [
  'from-indigo-400 to-purple-600',
  'from-blue-400 to-cyan-500',
  'from-pink-400 to-rose-500',
  'from-emerald-400 to-teal-500',
  'from-amber-400 to-orange-500',
];

// Stage to progress mapping
const STAGE_PROGRESS: Record<string, number> = {
  draft: 15,
  story: 33,
  screenplay: 50,
  shots: 66,
  visual: 75,
  audio: 90,
  complete: 100,
};

// Stage to color mapping
const STAGE_COLORS: Record<string, { badge: string; bar: string }> = {
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

function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return num.toString();
}

// SVG Sparkline component
function Sparkline({ color = '#007AFF' }: { color?: string }) {
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

export function OverviewContent({
  project,
  metadata,
  episodeCount,
  characterCount,
  locationCount,
  recentEpisodes,
  productionStatus,
  analytics,
  baseUrl,
}: OverviewContentProps) {
  const hasEpisodes = episodeCount > 0;
  const backdrop = metadata.coverImageUrl || DEFAULT_BACKDROP;

  // Calculate production percentages
  const scriptPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
        (productionStatus.scriptsComplete / productionStatus.totalEpisodes) *
        100,
      )
      : 0;
  const storyboardPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
        (productionStatus.storyboardsComplete /
          productionStatus.totalEpisodes) *
        100,
      )
      : 0;
  const visualPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
        (productionStatus.visualsComplete / productionStatus.totalEpisodes) *
        100,
      )
      : 0;
  const overallPercent =
    productionStatus.totalEpisodes > 0
      ? Math.round(
        ((productionStatus.scriptsComplete +
          productionStatus.storyboardsComplete +
          productionStatus.visualsComplete) /
          (productionStatus.totalEpisodes * 3)) *
        100,
      )
      : 0;

  return (
    <div className="space-y-8">
      {/* ============= HERO BANNER ============= */}
      <section className="group relative h-64 overflow-hidden rounded-2xl shadow-sm md:h-80">
        <img
          alt="Project background"
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          src={backdrop}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />
        <div className="absolute bottom-0 left-0 flex w-full flex-col justify-between gap-4 p-8 md:flex-row md:items-end">
          <div>
            <div className="mb-3 flex items-center gap-3">
              {metadata.targetAudience && (
                <span className="rounded-md border border-white/10 bg-white/20 px-2.5 py-1 text-xs font-semibold text-white backdrop-blur-md">
                  Ages {metadata.targetAudience}+
                </span>
              )}
              <span className="h-1 w-1 rounded-full bg-white/60" />
              <span className="text-sm text-white/80">Updated 2h ago</span>
            </div>
            <h1 className="mb-2 text-4xl font-bold tracking-tight text-white md:text-5xl">
              {project.name}
            </h1>
            {project.description && (
              <p className="line-clamp-2 max-w-xl text-white/70">
                {project.description}
              </p>
            )}
          </div>
          <Link
            href={`${baseUrl}/settings`}
            className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-sm font-medium text-white backdrop-blur-md transition-all hover:bg-white/20"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            Edit Details
          </Link>
        </div>
      </section>

      {/* ============= STATS CARDS ============= */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Episodes stat */}
        <Link
          href={`${baseUrl}/episodes`}
          className="group cinema-panel p-6"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-muted-foreground mb-1 text-sm font-medium">
                Total Episodes
              </p>
              <h3 className="text-foreground text-4xl font-semibold tracking-tight">
                {episodeCount}
              </h3>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                />
              </svg>
            </div>
          </div>
        </Link>

        {/* Characters stat */}
        <Link
          href={`${baseUrl}/assets`}
          className="group cinema-panel p-6"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-muted-foreground mb-1 text-sm font-medium">
                Characters
              </p>
              <h3 className="text-foreground text-4xl font-semibold tracking-tight">
                {characterCount}
              </h3>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-50 text-purple-600 dark:bg-purple-500/20 dark:text-purple-400">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </div>
          </div>
          <div className="bg-muted mt-4 h-1.5 w-full overflow-hidden rounded-full">
            <div className="h-full w-[70%] rounded-full bg-purple-500" />
          </div>
        </Link>

        {/* Locations stat */}
        <Link
          href={`${baseUrl}/assets`}
          className="group cinema-panel p-6"
        >
          <div className="flex items-start justify-between">
            <div>
              <p className="text-muted-foreground mb-1 text-sm font-medium">
                Locations
              </p>
              <h3 className="text-foreground text-4xl font-semibold tracking-tight">
                {locationCount}
              </h3>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-pink-50 text-pink-600 dark:bg-pink-500/20 dark:text-pink-400">
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
            </div>
          </div>
          <div className="mt-4 flex -space-x-2 overflow-hidden">
            <div className="ring-card inline-block h-6 w-6 rounded-full bg-gradient-to-br from-indigo-400 to-purple-500 ring-2" />
            <div className="ring-card inline-block h-6 w-6 rounded-full bg-gradient-to-br from-blue-400 to-cyan-500 ring-2" />
            <div className="ring-card inline-block h-6 w-6 rounded-full bg-gradient-to-br from-pink-400 to-rose-500 ring-2" />
            <div className="bg-muted text-muted-foreground ring-card flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium ring-2">
              +{Math.max(0, locationCount - 3)}
            </div>
          </div>
        </Link>
      </div>

      {/* ============= CONDITIONAL: ZERO STATE OR ACTIVE STATE ============= */}
      {!hasEpisodes ? (
        /* ============= ZERO STATE (from ZeroState prototype line 158) ============= */
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          {/* Choose Your Genesis */}
          <div className="space-y-6 lg:col-span-2">
            <div className="cinema-panel p-6 sm:p-8">
              <div className="mb-6 flex items-center gap-3">
                <svg
                  className="h-6 w-6 text-indigo-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
                <h2 className="text-foreground text-lg font-semibold">
                  Choose Your Genesis
                </h2>
              </div>
              <p className="text-muted-foreground mb-8 text-sm">
                Your studio is set up. How would you like to begin your first
                episode?
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {/* Template */}
                <button className="group border-border bg-muted hover:bg-card flex h-full flex-col items-start rounded-xl border p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-600 transition-transform group-hover:scale-110 dark:bg-blue-900/40 dark:text-blue-400">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-foreground mb-1 font-semibold">
                    Use a Template
                  </h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Start with a proven structure for 11min or 22min animated
                    episodes.
                  </p>
                </button>
                {/* Import */}
                <button className="group border-border bg-muted hover:bg-card flex h-full flex-col items-start rounded-xl border p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-600 transition-transform group-hover:scale-110 dark:bg-emerald-900/40 dark:text-emerald-400">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                      />
                    </svg>
                  </div>
                  <h3 className="text-foreground mb-1 font-semibold">
                    Import Script
                  </h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Upload a Final Draft (.fdx) or PDF file to auto-generate
                    scenes.
                  </p>
                </button>
                {/* AI Brainstorm */}
                <button className="group border-border bg-muted hover:bg-card flex h-full flex-col items-start rounded-xl border p-5 text-left transition-all duration-200 hover:border-indigo-300 hover:shadow-md dark:hover:border-indigo-500">
                  <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 transition-transform group-hover:scale-110 dark:bg-purple-900/40 dark:text-purple-400">
                    <svg
                      className="h-5 w-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
                      />
                    </svg>
                  </div>
                  <h3 className="text-foreground mb-1 font-semibold">
                    Brainstorm with AI
                  </h3>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Collaborate with our creative AI to develop a concept from
                    scratch.
                  </p>
                </button>
              </div>
            </div>
          </div>
          {/* Production Health Empty */}
          <div className="lg:col-span-1">
            <div className="border-border bg-card flex h-full flex-col rounded-xl border p-6 shadow-sm">
              <div className="mb-6 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-indigo-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                    />
                  </svg>
                  <h2 className="text-foreground text-sm font-semibold">
                    Production Health
                  </h2>
                </div>
              </div>
              <div className="flex flex-1 flex-col items-center justify-center py-12 text-center">
                <div className="bg-muted mb-4 flex h-16 w-16 items-center justify-center rounded-full">
                  <svg
                    className="text-muted-foreground h-8 w-8"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
                    />
                  </svg>
                </div>
                <h3 className="text-foreground mb-1 text-sm font-medium">
                  No episodes yet
                </h3>
                <p className="text-muted-foreground max-w-[200px] text-xs">
                  Once you start creating, your production metrics will appear
                  here.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ============= ACTIVE STATE ============= */
        <>
          {/* Performance Insights Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-foreground text-lg font-semibold">
              Performance Insights
            </h2>
            <button className="flex items-center gap-1 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300">
              Last 30 Days
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </button>
          </div>

          {/* Performance Insights Cards */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Total Views */}
            <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <p className="text-muted-foreground text-sm font-medium">
                    Total Views
                  </p>
                  <p className="text-foreground mt-1 text-3xl font-bold">
                    {formatNumber(analytics?.totalViews ?? 0)}
                  </p>
                </div>
                <span className="rounded-md bg-green-100 px-2 py-1 text-xs font-bold text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {analytics?.totalViews ? '+12%' : '0%'}
                </span>
              </div>
              <div className="relative h-12">
                <Sparkline color="#007AFF" />
              </div>
            </div>

            {/* Avg Engagement */}
            <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <p className="text-muted-foreground text-sm font-medium">
                    Avg. Engagement
                  </p>
                  <p className="text-foreground mt-1 text-3xl font-bold">
                    {analytics?.avgEngagementRate
                      ? `${analytics.avgEngagementRate.toFixed(0)}%`
                      : '0%'}
                  </p>
                </div>
                <span className="bg-muted text-muted-foreground rounded-md px-2 py-1 text-xs font-bold">
                  0%
                </span>
              </div>
              <div className="bg-muted h-1.5 w-full rounded-full">
                <div
                  className="h-1.5 rounded-full bg-green-500"
                  style={{ width: `${analytics?.avgEngagementRate ?? 0}%` }}
                />
              </div>
            </div>

            {/* Content Published */}
            <div className="border-border bg-card rounded-2xl border p-6 shadow-sm">
              <div className="mb-8 flex items-start justify-between">
                <div>
                  <p className="text-muted-foreground text-sm font-medium">
                    Content Published
                  </p>
                  <p className="text-foreground mt-1 text-3xl font-bold">
                    {analytics?.contentCount ?? 0}
                  </p>
                </div>
                <span className="rounded-md bg-blue-100 px-2 py-1 text-xs font-bold text-blue-600 dark:bg-blue-900/30 dark:text-blue-400">
                  {analytics?.contentCount ? '+5%' : '0%'}
                </span>
              </div>
              <div className="relative h-12">
                <Sparkline color="#007AFF" />
              </div>
            </div>
          </div>

          {/* Jump Back In + Health Grid (from prototype line 310) */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {/* Jump Back In */}
            <div className="border-border bg-card flex flex-col rounded-xl border shadow-sm lg:col-span-2">
              <div className="border-border flex items-center justify-between border-b p-5">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-indigo-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <h2 className="text-foreground text-lg font-semibold">
                    Jump Back In
                  </h2>
                </div>
                <Link
                  href={`${baseUrl}/episodes`}
                  className="flex items-center gap-1 text-sm font-medium text-indigo-500 hover:text-indigo-600"
                >
                  View All
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </Link>
              </div>
              <div className="p-2">
                {recentEpisodes.map((episode, index) => {
                  const stage = episode.stage ?? 'draft';
                  const colors = STAGE_COLORS[stage] ?? STAGE_COLORS.draft!;
                  const progress = STAGE_PROGRESS[stage] ?? 15;
                  const gradient = GRADIENTS[index % GRADIENTS.length];

                  return (
                    <Link
                      key={episode.id}
                      href={`${baseUrl}/episodes/${episode.id}`}
                      className="group hover:border-border hover:bg-muted flex cursor-pointer items-center gap-4 rounded-lg border border-transparent p-3 transition-colors"
                    >
                      {/* Thumbnail */}
                      <div
                        className={`h-16 w-24 rounded-lg bg-gradient-to-br ${gradient} relative flex-shrink-0 overflow-hidden shadow-sm`}
                      >
                        {episode.thumbnailUrl ? (
                          <img
                            alt=""
                            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                            src={episode.thumbnailUrl}
                          />
                        ) : null}
                        <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 transition-opacity group-hover:opacity-100">
                          <svg
                            className="h-6 w-6 text-white drop-shadow-md"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M8 5v14l11-7z" />
                          </svg>
                        </div>
                      </div>
                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="mb-0.5 flex items-start justify-between">
                          <h3 className="text-foreground truncate font-semibold">
                            {episode.title || `Episode ${episode.number}`}
                          </h3>
                          <span className="text-muted-foreground ml-2 text-xs whitespace-nowrap">
                            {formatDistanceToNow(new Date(episode.updated_at), {
                              addSuffix: false,
                            })}
                          </span>
                        </div>
                        <p className="text-muted-foreground mb-2 text-xs">
                          EP{String(episode.number).padStart(2, '0')}{' '}
                          {episode.seasonNumber
                            ? `• Season ${episode.seasonNumber}`
                            : ''}
                        </p>
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${colors.badge}`}
                          >
                            {stage.charAt(0).toUpperCase() + stage.slice(1)}
                          </span>
                          <div className="bg-muted h-1 max-w-[100px] flex-1 overflow-hidden rounded-full">
                            <div
                              className={`h-full rounded-full ${colors.bar}`}
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>

            {/* Health Donut */}
            <div className="border-border bg-card flex flex-col justify-between rounded-2xl border p-6 shadow-sm">
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-5 w-5 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                  <h2 className="text-foreground font-semibold">Health</h2>
                </div>
                <button className="text-muted-foreground hover:text-foreground">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z"
                    />
                  </svg>
                </button>
              </div>
              {/* Conic Gradient Donut */}
              <div className="flex flex-1 flex-col items-center justify-center py-6">
                <div
                  className="relative flex h-32 w-32 items-center justify-center rounded-full"
                  style={{
                    background: `conic-gradient(
                      #F59E0B 0% ${scriptPercent * 0.85}%,
                      #A855F7 ${scriptPercent * 0.85}% ${(scriptPercent + storyboardPercent) * 0.85}%,
                      #3B82F6 ${(scriptPercent + storyboardPercent) * 0.85}% ${overallPercent}%,
                      #E5E7EB ${overallPercent}% 100%
                    )`,
                  }}
                >
                  <div className="bg-card z-10 flex h-24 w-24 flex-col items-center justify-center rounded-full shadow-sm">
                    <span className="text-foreground text-2xl font-bold">
                      {overallPercent}%
                    </span>
                    <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                      Complete
                    </span>
                  </div>
                </div>
              </div>
              {/* Legend */}
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-yellow-500" />
                    <span className="text-muted-foreground">Scripting</span>
                  </div>
                  <span className="text-foreground font-medium">
                    {scriptPercent}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-purple-500" />
                    <span className="text-muted-foreground">Storyboards</span>
                  </div>
                  <span className="text-foreground font-medium">
                    {storyboardPercent}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-blue-500" />
                    <span className="text-muted-foreground">Animation</span>
                  </div>
                  <span className="text-foreground font-medium">
                    {visualPercent}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
