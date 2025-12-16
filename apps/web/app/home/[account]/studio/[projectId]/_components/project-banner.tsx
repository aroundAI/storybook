'use client';

import Link from 'next/link';

import { Pencil, Play } from 'lucide-react';

import { Button } from '@kit/ui/button';

interface ProjectBannerProps {
    name: string;
    description: string;
    genre?: string;
    targetAudience?: string;
    format?: string;
    posterUrl?: string;
    backgroundUrl?: string;
    createdBy?: string;
    baseUrl?: string;
}

// Default Unsplash URLs for cinematic look
const DEFAULT_BACKDROP = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1025&auto=format&fit=crop';

/**
 * ProjectBanner - Cinematic hero matching Google Stitch design
 * Rounded container, Ages badge, Genre, Created by, Edit Details + Resume buttons
 */
export function ProjectBanner({
    name,
    description,
    genre,
    targetAudience,
    format,
    posterUrl,
    backgroundUrl,
    createdBy = 'Unknown',
    baseUrl,
}: ProjectBannerProps) {
    const backdrop = backgroundUrl || DEFAULT_BACKDROP;
    const poster = posterUrl || DEFAULT_POSTER;

    return (
        <div className="relative h-[280px] rounded-3xl overflow-hidden mb-6 border border-zinc-700/50">
            {/* Background Layer - Real image with gradient overlay */}
            <div className="absolute inset-0">
                <img
                    src={backdrop}
                    alt=""
                    className="w-full h-full object-cover"
                />
                {/* Gradient overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/70 to-zinc-900/30" />
            </div>

            {/* Content Layer - Bottom aligned */}
            <div className="relative z-10 flex items-end h-full p-6 gap-6">
                {/* Poster Art (2:3 ratio) */}
                <div className="hidden sm:block shrink-0">
                    <div className="w-28 aspect-[2/3] rounded-xl overflow-hidden shadow-2xl border border-white/10">
                        <img
                            src={poster}
                            alt={`${name} poster`}
                            className="w-full h-full object-cover"
                        />
                    </div>
                </div>

                {/* Text Block */}
                <div className="flex-1 min-w-0">
                    {/* Title */}
                    <h1 className="text-3xl font-bold text-white mb-2">
                        {name}
                    </h1>

                    {/* Metadata row: Ages • Genre • Created by */}
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                        {/* Target audience badge */}
                        {targetAudience && (
                            <span className="bg-zinc-800/80 backdrop-blur border border-zinc-700 text-white text-[11px] font-semibold px-2.5 py-0.5 rounded-md">
                                {targetAudience.includes('-') ? `Ages ${targetAudience}` : `Ages ${targetAudience}+`}
                            </span>
                        )}
                        {/* Separator */}
                        {(targetAudience && (genre || format)) && (
                            <span className="text-zinc-500">•</span>
                        )}
                        {/* Genre and format */}
                        {(genre || format) && (
                            <span className="text-zinc-300 text-sm">
                                {[genre, format].filter(Boolean).join(', ')}
                            </span>
                        )}
                        {/* Separator */}
                        {(genre || format) && createdBy && (
                            <span className="text-zinc-500">•</span>
                        )}
                        {/* Created by */}
                        {createdBy && (
                            <span className="text-zinc-300 text-sm">
                                Created by {createdBy}
                            </span>
                        )}
                    </div>

                    {/* Description/Premise */}
                    {description && (
                        <p className="text-zinc-400 text-sm max-w-2xl line-clamp-2 leading-relaxed">
                            {description}
                        </p>
                    )}
                </div>

                {/* Action Buttons - Right side */}
                {baseUrl && (
                    <div className="flex items-center gap-3 shrink-0">
                        <Button
                            variant="outline"
                            asChild
                            className="bg-zinc-800/80 backdrop-blur border-zinc-700 text-white hover:bg-zinc-700 rounded-xl"
                        >
                            <Link href={`${baseUrl}/settings`}>
                                <Pencil className="mr-2 h-4 w-4" />
                                Edit Details
                            </Link>
                        </Button>
                        <Button
                            asChild
                            className="bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl"
                        >
                            <Link href={`${baseUrl}/episodes`}>
                                <Play className="mr-2 h-4 w-4 fill-current" />
                                Resume
                            </Link>
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
