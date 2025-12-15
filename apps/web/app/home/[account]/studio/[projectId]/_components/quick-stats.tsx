'use client';

/**
 * QuickStats Component - Stats with action buttons
 * Matches Google Stitch ActiveState-Overview design
 * All values fetched from database, no hardcoded values
 */

import Link from 'next/link';

import { Clapperboard, MapPin, Plus, Sparkles, Users } from 'lucide-react';

import { Button } from '@kit/ui/button';

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
        {
            label: 'EPISODES',
            value: episodeCount,
            icon: Clapperboard,
            iconColor: 'text-indigo-400',
            hoverBorder: 'hover:border-indigo-200 dark:hover:border-indigo-900',
            href: baseUrl ? `${baseUrl}/episodes` : undefined,
        },
        {
            label: 'CHARACTERS',
            value: characterCount,
            icon: Users,
            iconColor: 'text-purple-400',
            hoverBorder: 'hover:border-purple-200 dark:hover:border-purple-900',
            href: baseUrl ? `${baseUrl}/assets` : undefined,
        },
        {
            label: 'LOCATIONS',
            value: locationCount,
            icon: MapPin,
            iconColor: 'text-teal-400',
            hoverBorder: 'hover:border-teal-200 dark:hover:border-teal-900',
            href: baseUrl ? `${baseUrl}/assets` : undefined,
        },
    ];

    return (
        <div className="flex items-center justify-between gap-4 mb-6">
            {/* Stats Cards on Left */}
            <div className="flex gap-4">
                {stats.map((stat) => {
                    const Icon = stat.icon;
                    const content = (
                        <div
                            className={`bg-white dark:bg-zinc-900 p-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 shadow-sm min-w-[140px] flex flex-col justify-between group ${stat.hoverBorder} transition-colors cursor-pointer`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-zinc-500 dark:text-zinc-400 text-xs font-medium uppercase tracking-wider">
                                    {stat.label}
                                </span>
                                <Icon className={`w-5 h-5 ${stat.iconColor} group-hover:scale-110 transition-transform`} />
                            </div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-bold text-zinc-900 dark:text-white">
                                    {stat.value}
                                </span>
                            </div>
                        </div>
                    );

                    return stat.href ? (
                        <Link key={stat.label} href={stat.href}>
                            {content}
                        </Link>
                    ) : (
                        <div key={stat.label}>
                            {content}
                        </div>
                    );
                })}
            </div>

            {/* Action Buttons on Right */}
            {baseUrl && (
                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        asChild
                        className="border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 rounded-xl"
                    >
                        <Link href={`${baseUrl}/assets`}>
                            <Plus className="mr-2 h-4 w-4" />
                            Add Asset
                        </Link>
                    </Button>
                    <Button
                        asChild
                        className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/25 rounded-xl"
                    >
                        <Link href={`${baseUrl}/episodes`}>
                            <Sparkles className="mr-2 h-4 w-4" />
                            New Episode
                        </Link>
                    </Button>
                </div>
            )}
        </div>
    );
}
