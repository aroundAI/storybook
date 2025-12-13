'use client';

/**
 * QuickStats Component
 *
 * Displays compact stat tiles for project overview:
 * - Episodes count
 * - Characters count
 * - Locations count
 */

import { Clapperboard, MapPin, Users } from 'lucide-react';

import { cn } from '@kit/ui/utils';

interface QuickStatsProps {
    episodeCount: number;
    characterCount: number;
    locationCount: number;
}

export function QuickStats({
    episodeCount,
    characterCount,
    locationCount,
}: QuickStatsProps) {
    const stats = [
        {
            label: 'Episodes',
            value: episodeCount,
            icon: Clapperboard,
            color: 'text-primary',
            bgColor: 'bg-primary/10',
        },
        {
            label: 'Characters',
            value: characterCount,
            icon: Users,
            color: 'text-orange-500',
            bgColor: 'bg-orange-500/10',
        },
        {
            label: 'Locations',
            value: locationCount,
            icon: MapPin,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
        },
    ];

    return (
        <div className="flex items-center gap-6">
            {stats.map((stat) => {
                const Icon = stat.icon;
                return (
                    <div key={stat.label} className="flex items-center gap-2">
                        <div
                            className={cn(
                                'flex h-8 w-8 items-center justify-center rounded-lg',
                                stat.bgColor,
                            )}
                        >
                            <Icon className={cn('h-4 w-4', stat.color)} />
                        </div>
                        <div>
                            <span className="text-lg font-bold">{stat.value}</span>
                            <span className="ml-1 text-sm text-muted-foreground">
                                {stat.label}
                            </span>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
