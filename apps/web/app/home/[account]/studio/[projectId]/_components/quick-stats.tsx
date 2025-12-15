'use client';

/**
 * QuickStats Component - The Control Strip
 *
 * Stats on left with 2xl font-bold + 10px uppercase labels.
 * Actions on right with inverted colors for contrast.
 */

import Link from 'next/link';

import { ChevronDown, Clapperboard, MapPin, Plus, Sparkles, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface QuickStatsProps {
    episodeCount: number;
    characterCount: number;
    locationCount: number;
    baseUrl?: string;
}

export function QuickStats({
    episodeCount,
    characterCount,
    locationCount,
    baseUrl,
}: QuickStatsProps) {
    const stats = [
        { label: 'EPISODES', value: episodeCount, icon: Clapperboard },
        { label: 'CHARACTERS', value: characterCount, icon: Users },
        { label: 'LOCATIONS', value: locationCount, icon: MapPin },
    ];

    return (
        <div className="flex items-center justify-between gap-6 py-4 mb-6">
            {/* Stats (Left) */}
            <div className="flex gap-8">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div key={stat.label} className="flex items-center gap-3">
                            <Icon className="h-5 w-5 text-indigo-500 dark:text-indigo-400" />
                            <div>
                                <span className="text-2xl font-bold text-zinc-900 dark:text-white tracking-tight">
                                    {stat.value}
                                </span>
                                <span className="block text-[10px] text-zinc-500 font-bold uppercase tracking-wider mt-0.5">
                                    {stat.label}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Actions (Right) - Inverted for contrast */}
            <div className="flex items-center gap-2">
                {/* Primary: Inverted in dark mode */}
                {baseUrl && (
                    <Button asChild className="bg-white text-zinc-900 hover:bg-zinc-200 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200">
                        <Link href={`${baseUrl}/episodes`}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            New Episode
                        </Link>
                    </Button>
                )}

                {/* Secondary: Ghost with border */}
                {baseUrl && (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300">
                                <Plus className="mr-2 h-4 w-4" />
                                Add Asset
                                <ChevronDown className="ml-2 h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="bg-white dark:bg-[#18181B] border-zinc-200 dark:border-white/10">
                            <DropdownMenuItem asChild>
                                <Link href={`${baseUrl}/characters`} className="flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-white/5">
                                    <Users className="h-4 w-4" />
                                    Add Character
                                </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                                <Link href={`${baseUrl}/locations`} className="flex items-center gap-2 hover:bg-zinc-100 dark:hover:bg-white/5">
                                    <MapPin className="h-4 w-4" />
                                    Add Location
                                </Link>
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}
