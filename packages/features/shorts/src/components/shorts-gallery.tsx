'use client';

import { useState } from 'react';

import {
    AlertCircle,
    CheckCircle2,
    Clock,
    ExternalLink,
    Facebook,
    Instagram,
    Loader2,
    MoreVertical,
    Play,
    Trash2,
    Youtube,
} from 'lucide-react';

import { Button } from '@kit/ui/button';

import type { Short } from '../server/shorts-queries';

interface ShortsGalleryProps {
    shorts: Short[];
    onPublish?: (shortId: string) => void;
    onDelete?: (shortId: string) => void;
}

const STATUS_CONFIG = {
    pending: {
        icon: Clock,
        label: 'Pending',
        className: 'text-gray-500 bg-gray-100 dark:bg-gray-800',
    },
    processing: {
        icon: Loader2,
        label: 'Processing',
        className: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30',
        animate: true,
    },
    ready: {
        icon: CheckCircle2,
        label: 'Ready',
        className: 'text-green-600 bg-green-100 dark:bg-green-900/30',
    },
    failed: {
        icon: AlertCircle,
        label: 'Failed',
        className: 'text-red-600 bg-red-100 dark:bg-red-900/30',
    },
} as const;

const PLATFORM_ICONS = {
    youtube: Youtube,
    instagram: Instagram,
    facebook: Facebook,
    tiktok: () => (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-5.2 1.74 2.89 2.89 0 012.31-4.64 2.93 2.93 0 01.88.13V9.4a6.84 6.84 0 00-1-.05A6.33 6.33 0 005 20.1a6.34 6.34 0 0010.86-4.43v-7a8.16 8.16 0 004.77 1.52v-3.4a4.85 4.85 0 01-1-.1z" />
        </svg>
    ),
};

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${secs}s`;
}

export function ShortsGallery({
    shorts,
    onPublish,
    onDelete,
}: ShortsGalleryProps) {
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

    if (shorts.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
                <Play className="mb-3 h-12 w-12 text-gray-400" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">
                    No Shorts Generated Yet
                </h3>
                <p className="mt-2 max-w-sm text-sm text-gray-500 dark:text-gray-400">
                    Generate shorts from the candidates list to see them here.
                    Once generated, you can preview and publish them to multiple platforms.
                </p>
            </div>
        );
    }

    return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {shorts.map((short) => {
                const statusConfig = STATUS_CONFIG[short.status];
                const StatusIcon = statusConfig.icon;

                return (
                    <div
                        key={short.id}
                        className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800"
                    >
                        {/* Video preview */}
                        <div className="relative aspect-[9/16] bg-gray-900">
                            {short.videoUrl9x16 ? (
                                playingId === short.id ? (
                                    <video
                                        src={short.videoUrl9x16}
                                        className="h-full w-full object-cover"
                                        autoPlay
                                        loop
                                        muted
                                        playsInline
                                        onEnded={() => setPlayingId(null)}
                                    />
                                ) : (
                                    <div
                                        className="flex h-full cursor-pointer items-center justify-center bg-gradient-to-br from-gray-800 to-gray-900"
                                        onClick={() => setPlayingId(short.id)}
                                    >
                                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm transition-transform group-hover:scale-110">
                                            <Play className="h-6 w-6 text-white" fill="white" />
                                        </div>
                                    </div>
                                )
                            ) : (
                                <div className="flex h-full items-center justify-center">
                                    <StatusIcon
                                        className={`h-8 w-8 ${'animate' in statusConfig && statusConfig.animate ? 'animate-spin' : ''}`}
                                    />
                                </div>
                            )}

                            {/* Duration badge */}
                            <div className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white">
                                {formatDuration(short.durationSeconds)}
                            </div>

                            {/* Menu */}
                            <div className="absolute right-2 top-2">
                                <button
                                    onClick={() =>
                                        setMenuOpenId(menuOpenId === short.id ? null : short.id)
                                    }
                                    className="rounded-full bg-black/50 p-1.5 opacity-0 transition-opacity group-hover:opacity-100"
                                >
                                    <MoreVertical className="h-4 w-4 text-white" />
                                </button>

                                {menuOpenId === short.id && (
                                    <div className="absolute right-0 top-8 z-10 w-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                                        <button
                                            onClick={() => {
                                                onPublish?.(short.id);
                                                setMenuOpenId(null);
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                                        >
                                            <ExternalLink className="h-4 w-4" />
                                            Publish
                                        </button>
                                        <button
                                            onClick={() => {
                                                onDelete?.(short.id);
                                                setMenuOpenId(null);
                                            }}
                                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            Delete
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-3">
                            {/* Status */}
                            <div className="mb-2 flex items-center gap-2">
                                <span
                                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${statusConfig.className}`}
                                >
                                    <StatusIcon
                                        className={`h-3 w-3 ${'animate' in statusConfig && statusConfig.animate ? 'animate-spin' : ''}`}
                                    />
                                    {statusConfig.label}
                                </span>

                                {short.viralScore && (
                                    <span className="text-xs text-gray-500">
                                        🔥 {short.viralScore}/10
                                    </span>
                                )}
                            </div>

                            {/* Title */}
                            <h4 className="line-clamp-1 text-sm font-medium text-gray-900 dark:text-white">
                                {short.title ?? `Shot ${short.sourceShot?.sequenceNumber ?? '?'}`}
                            </h4>

                            {/* Summary */}
                            {short.standaloneSummary && (
                                <p className="mt-1 line-clamp-2 text-xs text-gray-500 dark:text-gray-400">
                                    {short.standaloneSummary}
                                </p>
                            )}

                            {/* Publications */}
                            {short.publications.length > 0 && (
                                <div className="mt-2 flex items-center gap-1">
                                    {short.publications.map((pub) => {
                                        const PlatformIcon =
                                            PLATFORM_ICONS[pub.platform as keyof typeof PLATFORM_ICONS] ??
                                            ExternalLink;
                                        return (
                                            <a
                                                key={pub.id}
                                                href={pub.platformUrl ?? '#'}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="rounded-full bg-gray-100 p-1.5 text-gray-600 transition-colors hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400"
                                                title={`${pub.platform} (${pub.language})`}
                                            >
                                                <PlatformIcon />
                                            </a>
                                        );
                                    })}
                                </div>
                            )}

                            {/* Publish button for ready shorts */}
                            {short.status === 'ready' && short.publications.length === 0 && (
                                <Button
                                    size="sm"
                                    className="mt-2 w-full"
                                    onClick={() => onPublish?.(short.id)}
                                >
                                    Publish
                                </Button>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
