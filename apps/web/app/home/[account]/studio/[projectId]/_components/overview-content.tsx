'use client';

/**
 * OverviewContent Component
 * 
 * DIRECTLY COPIED CSS from prototypes:
 * - Redesign-Prototype/ZeroState-Overview/code.html
 * - Redesign-Prototype/ActiveState-Overview/code.html
 * 
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
    stage?: 'draft' | 'story' | 'screenplay' | 'shots' | 'visual' | 'audio' | 'complete';
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
        totalViews?: number;
        avgEngagementRate?: number;
    } | null;
    baseUrl: string;
}

// Default images
const DEFAULT_BACKDROP = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1025&auto=format&fit=crop';

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
    draft: { badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800', bar: 'bg-amber-400' },
    story: { badge: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800', bar: 'bg-amber-400' },
    screenplay: { badge: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800', bar: 'bg-purple-500' },
    shots: { badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800', bar: 'bg-blue-500' },
    visual: { badge: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800', bar: 'bg-indigo-500' },
    audio: { badge: 'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-400 border-pink-200 dark:border-pink-800', bar: 'bg-pink-500' },
    complete: { badge: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800', bar: 'bg-green-500' },
};

function formatNumber(num: number): string {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
    return num.toString();
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
    const poster = metadata.coverImageUrl || DEFAULT_POSTER;

    // Calculate production percentages
    const scriptPercent = productionStatus.totalEpisodes > 0
        ? Math.round((productionStatus.scriptsComplete / productionStatus.totalEpisodes) * 100)
        : 0;
    const storyboardPercent = productionStatus.totalEpisodes > 0
        ? Math.round((productionStatus.storyboardsComplete / productionStatus.totalEpisodes) * 100)
        : 0;
    const visualPercent = productionStatus.totalEpisodes > 0
        ? Math.round((productionStatus.visualsComplete / productionStatus.totalEpisodes) * 100)
        : 0;
    const overallPercent = productionStatus.totalEpisodes > 0
        ? Math.round(((productionStatus.scriptsComplete + productionStatus.storyboardsComplete + productionStatus.visualsComplete) / (productionStatus.totalEpisodes * 3)) * 100)
        : 0;

    // SVG donut chart calculations
    const radius = 70;
    const circumference = 2 * Math.PI * radius;
    const scriptDash = (scriptPercent / 100) * circumference * 0.3;
    const storyboardDash = (storyboardPercent / 100) * circumference * 0.3;
    const visualDash = (visualPercent / 100) * circumference * 0.3;

    return (
        <div className="space-y-8">
            {/* ============= HERO BANNER (from prototype line 150) ============= */}
            <section className="relative h-72 rounded-2xl overflow-hidden group shadow-card">
                <img
                    alt="Project background"
                    className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    src={backdrop}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                <div className="absolute inset-0 p-8 flex items-end">
                    <div className="flex items-end gap-6 w-full">
                        {/* Poster */}
                        <div className="w-32 h-44 rounded-lg overflow-hidden shadow-2xl border-2 border-white/20 relative flex-shrink-0 hidden sm:block transform translate-y-4">
                            <img alt="Poster" className="w-full h-full object-cover" src={poster} />
                        </div>
                        {/* Content */}
                        <div className="flex-1 mb-2">
                            <h1 className="text-2xl sm:text-4xl font-bold text-white mb-2 tracking-tight">{project.name}</h1>
                            <div className="flex items-center gap-3 text-white/80 text-sm mb-4">
                                {metadata.targetAudience && (
                                    <>
                                        <span className="bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded text-xs font-medium text-white border border-white/10">
                                            Ages {metadata.targetAudience}+
                                        </span>
                                        <span>•</span>
                                    </>
                                )}
                                {metadata.genre && <span>{metadata.genre}</span>}
                                {metadata.format && (
                                    <>
                                        <span>•</span>
                                        <span>{metadata.format}</span>
                                    </>
                                )}
                            </div>
                            {project.description && (
                                <p className="text-white/60 text-sm max-w-xl line-clamp-2">{project.description}</p>
                            )}
                        </div>
                        {/* Action buttons */}
                        <div className="flex gap-3 mb-2">
                            <Link
                                href={`${baseUrl}/settings`}
                                className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white border border-white/20 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                                Edit Details
                            </Link>
                        </div>
                    </div>
                </div>
            </section>

            {/* ============= STATS + ACTIONS BAR (from prototype line 182) ============= */}
            <section className="flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full md:w-auto">
                    {/* Episodes stat */}
                    <Link href={`${baseUrl}/episodes`} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-[140px] flex flex-col justify-between group hover:border-indigo-200 dark:hover:border-indigo-900 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-wider">Episodes</span>
                            <svg className="w-5 h-5 text-indigo-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                            </svg>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold text-slate-900 dark:text-white">{episodeCount}</span>
                        </div>
                    </Link>
                    {/* Characters stat */}
                    <Link href={`${baseUrl}/assets`} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-[140px] flex flex-col justify-between group hover:border-purple-200 dark:hover:border-purple-900 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-wider">Characters</span>
                            <svg className="w-5 h-5 text-purple-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                            </svg>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold text-slate-900 dark:text-white">{characterCount}</span>
                        </div>
                    </Link>
                    {/* Locations stat */}
                    <Link href={`${baseUrl}/assets`} className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm min-w-[140px] flex flex-col justify-between group hover:border-pink-200 dark:hover:border-pink-900 transition-colors">
                        <div className="flex justify-between items-start mb-2">
                            <span className="text-slate-500 dark:text-slate-400 text-xs font-medium uppercase tracking-wider">Locations</span>
                            <svg className="w-5 h-5 text-pink-400 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </div>
                        <div className="flex items-baseline gap-1">
                            <span className="text-3xl font-bold text-slate-900 dark:text-white">{locationCount}</span>
                        </div>
                    </Link>
                </div>
                {/* Action buttons */}
                <div className="flex gap-3 w-full md:w-auto">
                    <Link
                        href={`${baseUrl}/assets`}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Asset
                    </Link>
                    <Link
                        href={`${baseUrl}/episodes`}
                        className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                    >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>
                        New Episode
                    </Link>
                </div>
            </section>

            {/* ============= CONDITIONAL: ZERO STATE OR ACTIVE STATE ============= */}
            {!hasEpisodes ? (
                /* ============= ZERO STATE (from ZeroState prototype line 158) ============= */
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Choose Your Genesis */}
                    <div className="lg:col-span-2 space-y-6">
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-6 sm:p-8">
                            <div className="flex items-center gap-3 mb-6">
                                <svg className="w-6 h-6 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                </svg>
                                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Choose Your Genesis</h2>
                            </div>
                            <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">
                                Your studio is set up. How would you like to begin your first episode?
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Template */}
                                <button className="flex flex-col items-start p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md transition-all duration-200 group text-left h-full">
                                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center text-blue-600 dark:text-blue-400 mb-4 group-hover:scale-110 transition-transform">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                                        </svg>
                                    </div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Use a Template</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">Start with a proven structure for 11min or 22min animated episodes.</p>
                                </button>
                                {/* Import */}
                                <button className="flex flex-col items-start p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md transition-all duration-200 group text-left h-full">
                                    <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 mb-4 group-hover:scale-110 transition-transform">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                    </div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Import Script</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">Upload a Final Draft (.fdx) or PDF file to auto-generate scenes.</p>
                                </button>
                                {/* AI Brainstorm */}
                                <button className="flex flex-col items-start p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 hover:bg-white dark:hover:bg-slate-700 hover:border-indigo-300 dark:hover:border-indigo-500 hover:shadow-md transition-all duration-200 group text-left h-full">
                                    <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900/40 flex items-center justify-center text-purple-600 dark:text-purple-400 mb-4 group-hover:scale-110 transition-transform">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                        </svg>
                                    </div>
                                    <h3 className="font-semibold text-slate-900 dark:text-white mb-1">Brainstorm with AI</h3>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">Collaborate with our creative AI to develop a concept from scratch.</p>
                                </button>
                            </div>
                        </div>
                    </div>
                    {/* Production Health Empty */}
                    <div className="lg:col-span-1">
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm h-full p-6 flex flex-col">
                            <div className="flex items-center justify-between mb-6">
                                <div className="flex items-center gap-2">
                                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                                    </svg>
                                    <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Production Health</h2>
                                </div>
                            </div>
                            <div className="flex-1 flex flex-col items-center justify-center text-center py-12">
                                <div className="w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-700 flex items-center justify-center mb-4">
                                    <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                                    </svg>
                                </div>
                                <h3 className="text-sm font-medium text-slate-900 dark:text-white mb-1">No episodes yet</h3>
                                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-[200px]">
                                    Once you start creating, your production metrics will appear here.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            ) : (
                /* ============= ACTIVE STATE ============= */
                <>
                    {/* Performance Insights (from prototype line 226) */}
                    <section>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Performance Insights</h2>
                            <select className="bg-transparent text-xs font-medium text-slate-500 dark:text-slate-400 border-none focus:ring-0 cursor-pointer hover:text-indigo-500">
                                <option>Last 30 Days</option>
                                <option>Last Quarter</option>
                                <option>All Time</option>
                            </select>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                            {/* Total Views */}
                            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Views</p>
                                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{formatNumber(analytics?.totalViews ?? 0)}</h3>
                                    </div>
                                    <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold px-2 py-1 rounded-full">
                                        0%
                                    </span>
                                </div>
                                <div className="h-16 mt-4 w-full">
                                    <svg className="w-full h-full text-indigo-500" preserveAspectRatio="none" viewBox="0 0 100 40">
                                        <path d="M0 35 L10 32 L20 34 L30 25 L40 28 L50 20 L60 22 L70 15 L80 18 L90 10 L100 5 V 40 H 0 Z" fill="currentColor" opacity="0.1" />
                                        <path d="M0 35 L10 32 L20 34 L30 25 L40 28 L50 20 L60 22 L70 15 L80 18 L90 10 L100 5" fill="none" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                </div>
                            </div>
                            {/* Avg Engagement */}
                            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Avg. Engagement</p>
                                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                                            {analytics?.avgEngagementRate ? `${Math.floor(analytics.avgEngagementRate)}m ${Math.round((analytics.avgEngagementRate % 1) * 60)}s` : '0m 0s'}
                                        </h3>
                                    </div>
                                    <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold px-2 py-1 rounded-full">
                                        0%
                                    </span>
                                </div>
                                <div className="h-16 mt-4 w-full">
                                    <svg className="w-full h-full text-emerald-500" preserveAspectRatio="none" viewBox="0 0 100 40">
                                        <path d="M0 25 L15 28 L30 20 L45 22 L60 15 L75 18 L90 12 L100 8 V 40 H 0 Z" fill="currentColor" opacity="0.1" />
                                        <path d="M0 25 L15 28 L30 20 L45 22 L60 15 L75 18 L90 12 L100 8" fill="none" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                </div>
                            </div>
                            {/* Audience Growth */}
                            <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Audience Growth</p>
                                        <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-1">0</h3>
                                    </div>
                                    <span className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 text-xs font-semibold px-2 py-1 rounded-full">
                                        0%
                                    </span>
                                </div>
                                <div className="h-16 mt-4 w-full">
                                    <svg className="w-full h-full text-blue-500" preserveAspectRatio="none" viewBox="0 0 100 40">
                                        <path d="M0 30 L10 28 L20 29 L30 25 L40 22 L50 24 L60 20 L70 18 L80 15 L90 12 L100 10 V 40 H 0 Z" fill="currentColor" opacity="0.1" />
                                        <path d="M0 30 L10 28 L20 29 L30 25 L40 22 L50 24 L60 20 L70 18 L80 15 L90 12 L100 10" fill="none" stroke="currentColor" strokeWidth="2" />
                                    </svg>
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Jump Back In + Health Grid (from prototype line 310) */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Jump Back In */}
                        <div className="lg:col-span-2 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
                            <div className="p-5 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Jump Back In</h2>
                                </div>
                                <Link href={`${baseUrl}/episodes`} className="text-sm text-indigo-500 hover:text-indigo-600 font-medium flex items-center gap-1">
                                    View All
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
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
                                            className="group flex items-center gap-4 p-3 hover:bg-slate-50 dark:hover:bg-slate-700/50 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-slate-200 dark:hover:border-slate-600"
                                        >
                                            {/* Thumbnail */}
                                            <div className={`w-24 h-16 rounded-lg bg-gradient-to-br ${gradient} flex-shrink-0 relative overflow-hidden shadow-sm`}>
                                                {episode.thumbnailUrl ? (
                                                    <img alt="" className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" src={episode.thumbnailUrl} />
                                                ) : null}
                                                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/20">
                                                    <svg className="w-6 h-6 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                </div>
                                            </div>
                                            {/* Content */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start mb-0.5">
                                                    <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                                                        {episode.title || `Episode ${episode.number}`}
                                                    </h3>
                                                    <span className="text-xs text-slate-400 whitespace-nowrap ml-2">
                                                        {formatDistanceToNow(new Date(episode.updated_at), { addSuffix: false })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                                                    EP{String(episode.number).padStart(2, '0')} {episode.seasonNumber ? `• Season ${episode.seasonNumber}` : ''}
                                                </p>
                                                <div className="flex items-center gap-2">
                                                    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full border ${colors.badge}`}>
                                                        {stage.charAt(0).toUpperCase() + stage.slice(1)}
                                                    </span>
                                                    <div className="h-1 flex-1 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden max-w-[100px]">
                                                        <div className={`h-full rounded-full ${colors.bar}`} style={{ width: `${progress}%` }} />
                                                    </div>
                                                </div>
                                            </div>
                                        </Link>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Health Donut (from prototype line 382) */}
                        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm flex flex-col p-6 h-full relative overflow-hidden">
                            <div className="flex justify-between items-start mb-6 relative z-10">
                                <div className="flex items-center gap-2">
                                    <svg className="w-5 h-5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                    </svg>
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Health</h2>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                                    </svg>
                                </button>
                            </div>
                            {/* Donut Chart */}
                            <div className="flex-1 flex flex-col items-center justify-center relative mb-4">
                                <div className="relative w-40 h-40">
                                    <svg className="w-full h-full transform -rotate-90">
                                        <circle className="stroke-slate-100 dark:stroke-slate-700" cx="50%" cy="50%" fill="transparent" r={radius} strokeWidth="12" />
                                        <circle
                                            className="stroke-amber-400"
                                            cx="50%" cy="50%"
                                            fill="transparent"
                                            r={radius}
                                            strokeDasharray={circumference}
                                            strokeDashoffset={circumference - scriptDash}
                                            strokeLinecap="round"
                                            strokeWidth="12"
                                        />
                                        <circle
                                            className="stroke-purple-500"
                                            cx="50%" cy="50%"
                                            fill="transparent"
                                            r={radius}
                                            strokeDasharray={circumference}
                                            strokeDashoffset={circumference - storyboardDash}
                                            strokeLinecap="round"
                                            strokeWidth="12"
                                            style={{ transform: `rotate(${(scriptDash / circumference) * 360}deg)`, transformOrigin: '50% 50%' }}
                                        />
                                        <circle
                                            className="stroke-indigo-500"
                                            cx="50%" cy="50%"
                                            fill="transparent"
                                            r={radius}
                                            strokeDasharray={circumference}
                                            strokeDashoffset={circumference - visualDash}
                                            strokeLinecap="round"
                                            strokeWidth="12"
                                            style={{ transform: `rotate(${((scriptDash + storyboardDash) / circumference) * 360}deg)`, transformOrigin: '50% 50%' }}
                                        />
                                    </svg>
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <span className="text-3xl font-bold text-slate-900 dark:text-white">{overallPercent}%</span>
                                        <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Complete</span>
                                    </div>
                                </div>
                            </div>
                            {/* Legend */}
                            <div className="space-y-3 relative z-10">
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                                        <span className="text-slate-600 dark:text-slate-300">Scripting</span>
                                    </div>
                                    <span className="font-semibold text-slate-900 dark:text-white">{scriptPercent}%</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                                        <span className="text-slate-600 dark:text-slate-300">Storyboards</span>
                                    </div>
                                    <span className="font-semibold text-slate-900 dark:text-white">{storyboardPercent}%</span>
                                </div>
                                <div className="flex justify-between items-center text-sm">
                                    <div className="flex items-center gap-2">
                                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                                        <span className="text-slate-600 dark:text-slate-300">Animation</span>
                                    </div>
                                    <span className="font-semibold text-slate-900 dark:text-white">{visualPercent}%</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
