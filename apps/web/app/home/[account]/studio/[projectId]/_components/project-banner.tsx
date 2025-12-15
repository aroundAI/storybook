'use client';

import { Sparkles, Users } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';

interface TeamMember {
    id: string;
    name: string;
    avatarUrl?: string;
}

interface ProjectBannerProps {
    name: string;
    description: string;
    genre?: string;
    targetAudience?: string;
    format?: string;
    posterUrl?: string;
    backgroundUrl?: string;
    teamMembers?: TeamMember[];
}

// Default Unsplash URLs for cinematic look
const DEFAULT_BACKDROP = 'https://images.unsplash.com/photo-1626814026160-2237a95fc5a0?q=80&w=2070&auto=format&fit=crop';
const DEFAULT_POSTER = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?q=80&w=1025&auto=format&fit=crop';

/**
 * ProjectBanner - Cinematic hero with real backdrop image and gradient overlay
 * Uses Unsplash images for high-fidelity design
 */
export function ProjectBanner({
    name,
    description,
    genre,
    targetAudience,
    format,
    posterUrl,
    backgroundUrl,
    teamMembers = [],
}: ProjectBannerProps) {
    const backdrop = backgroundUrl || DEFAULT_BACKDROP;
    const poster = posterUrl || DEFAULT_POSTER;

    return (
        <div className="relative h-[320px] rounded-xl overflow-hidden mb-6 border border-zinc-200 dark:border-white/10">
            {/* Background Layer - Real image with gradient overlay */}
            <div className="absolute inset-0">
                <img
                    src={backdrop}
                    alt=""
                    className="w-full h-full object-cover"
                />
                {/* Gradient overlay for text readability */}
                <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 via-zinc-900/60 to-transparent" />
            </div>

            {/* Content Layer - Bottom aligned */}
            <div className="relative z-10 flex items-end h-full p-8 gap-6">
                {/* Poster Art (2:3 ratio) */}
                <div className="hidden sm:block shrink-0">
                    <div className="w-32 aspect-[2/3] rounded-lg overflow-hidden shadow-2xl border border-white/20">
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
                    <h1 className="text-4xl font-black text-white mb-2 tracking-tighter">
                        {name}
                    </h1>

                    {/* Metadata row */}
                    <div className="flex items-center gap-3 mb-3">
                        {/* Target audience badge */}
                        {targetAudience && (
                            <span className="bg-white/10 backdrop-blur border border-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                                {targetAudience.includes('-') ? `Ages ${targetAudience}` : `Ages ${targetAudience}+`}
                            </span>
                        )}
                        {/* Genre and format text */}
                        <span className="text-zinc-300 text-sm">
                            {[genre, format].filter(Boolean).join(' • ')}
                        </span>
                    </div>

                    {/* Description */}
                    {description && (
                        <p className="text-zinc-300 text-sm max-w-2xl line-clamp-2 leading-relaxed">
                            {description}
                        </p>
                    )}

                    {/* Team Facepile */}
                    {teamMembers.length > 0 && (
                        <div className="flex items-center gap-2 mt-4">
                            <div className="flex -space-x-2">
                                {teamMembers.slice(0, 4).map((member) => (
                                    <Avatar key={member.id} className="h-7 w-7 border-2 border-zinc-900">
                                        <AvatarImage src={member.avatarUrl} alt={member.name} />
                                        <AvatarFallback className="text-xs bg-zinc-700 text-white">
                                            {member.name.slice(0, 2).toUpperCase()}
                                        </AvatarFallback>
                                    </Avatar>
                                ))}
                            </div>
                            <span className="text-xs text-zinc-400">
                                {teamMembers.length} contributor{teamMembers.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
