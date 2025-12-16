'use client';

/**
 * ProductionStatus Component - Health Widget with Donut Chart
 * Matches Google Stitch ActiveState-Overview design
 */

import Link from 'next/link';

import { Film, Heart, MoreHorizontal, Sparkles } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader } from '@kit/ui/card';

interface ProductionStatusProps {
    scriptsComplete: number;
    storyboardsComplete: number;
    visualsComplete: number;
    totalEpisodes: number;
    baseUrl: string;
}

export function ProductionStatus({
    scriptsComplete,
    storyboardsComplete,
    visualsComplete,
    totalEpisodes,
    baseUrl,
}: ProductionStatusProps) {
    // Calculate percentages
    const scriptPercent = totalEpisodes > 0 ? Math.round((scriptsComplete / totalEpisodes) * 100) : 0;
    const storyboardPercent = totalEpisodes > 0 ? Math.round((storyboardsComplete / totalEpisodes) * 100) : 0;
    const visualPercent = totalEpisodes > 0 ? Math.round((visualsComplete / totalEpisodes) * 100) : 0;

    // Overall progress
    const totalComplete = scriptsComplete + storyboardsComplete + visualsComplete;
    const maxProgress = totalEpisodes * 3;
    const overallPercentage = maxProgress > 0 ? Math.round((totalComplete / maxProgress) * 100) : 0;

    // SVG donut chart calculations
    const radius = 70;
    const circumference = 2 * Math.PI * radius;

    // Calculate segment lengths based on percentages of total
    const scriptDash = (scriptPercent / 100) * circumference * 0.3; // Scale to fit
    const storyboardDash = (storyboardPercent / 100) * circumference * 0.3;
    const visualDash = (visualPercent / 100) * circumference * 0.3;

    // Empty state
    if (totalEpisodes === 0) {
        return (
            <Card className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm rounded-2xl">
                <CardHeader className="pb-3 border-b border-zinc-200 dark:border-zinc-800">
                    <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-semibold text-zinc-900 dark:text-white">Health</span>
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Film className="h-8 w-8 text-zinc-400 mb-3" />
                        <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No episodes yet</p>
                        <p className="text-xs text-zinc-500 mb-4">Create your first episode to track progress</p>
                        <Button asChild size="sm" variant="outline">
                            <Link href={`${baseUrl}/episodes`}>
                                <Sparkles className="mr-2 h-3 w-3" />
                                Get Started
                            </Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <Card className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-sm h-full rounded-2xl">
            <CardHeader className="pb-0 border-b border-zinc-200 dark:border-zinc-800 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <Heart className="h-4 w-4 text-emerald-500" />
                        <span className="text-lg font-semibold text-zinc-900 dark:text-white">Health</span>
                    </div>
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200">
                        <MoreHorizontal className="h-4 w-4" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="p-4">
                {/* Donut Chart */}
                <div className="flex flex-col items-center justify-center mb-6">
                    <div className="relative w-40 h-40">
                        <svg className="w-full h-full transform -rotate-90">
                            {/* Background circle */}
                            <circle
                                className="stroke-zinc-100 dark:stroke-zinc-800"
                                cx="50%"
                                cy="50%"
                                r={radius}
                                fill="transparent"
                                strokeWidth="12"
                            />
                            {/* Scripting segment - Amber */}
                            <circle
                                className="stroke-amber-400"
                                cx="50%"
                                cy="50%"
                                r={radius}
                                fill="transparent"
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={circumference - scriptDash}
                            />
                            {/* Storyboards segment - Purple */}
                            <circle
                                className="stroke-purple-500"
                                cx="50%"
                                cy="50%"
                                r={radius}
                                fill="transparent"
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={circumference - storyboardDash}
                                style={{
                                    transform: `rotate(${(scriptDash / circumference) * 360}deg)`,
                                    transformOrigin: '50% 50%'
                                }}
                            />
                            {/* Animation segment - Indigo */}
                            <circle
                                className="stroke-indigo-500"
                                cx="50%"
                                cy="50%"
                                r={radius}
                                fill="transparent"
                                strokeWidth="12"
                                strokeLinecap="round"
                                strokeDasharray={circumference}
                                strokeDashoffset={circumference - visualDash}
                                style={{
                                    transform: `rotate(${((scriptDash + storyboardDash) / circumference) * 360}deg)`,
                                    transformOrigin: '50% 50%'
                                }}
                            />
                        </svg>
                        {/* Center text */}
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span className="text-3xl font-bold text-zinc-900 dark:text-white">
                                {overallPercentage}%
                            </span>
                            <span className="text-xs text-zinc-500 dark:text-zinc-400 font-medium">
                                Complete
                            </span>
                        </div>
                    </div>
                </div>

                {/* Legend */}
                <div className="space-y-3">
                    <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                            <span className="text-zinc-600 dark:text-zinc-300">Scripting</span>
                        </div>
                        <span className="font-semibold text-zinc-900 dark:text-white">{scriptPercent}%</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                            <span className="text-zinc-600 dark:text-zinc-300">Storyboards</span>
                        </div>
                        <span className="font-semibold text-zinc-900 dark:text-white">{storyboardPercent}%</span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500" />
                            <span className="text-zinc-600 dark:text-zinc-300">Animation</span>
                        </div>
                        <span className="font-semibold text-zinc-900 dark:text-white">{visualPercent}%</span>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
