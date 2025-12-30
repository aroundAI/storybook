'use client';

/**
 * AudioAssetCard Component
 * 
 * Displays a single audio asset with waveform preview, playback controls,
 * and metadata (duration, usage count, status).
 */

import { useState, useRef } from 'react';
import { Play, Pause, Music, Volume2, MoreVertical, Download, Trash2, Copy } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { cn } from '@kit/ui/utils';

export interface AudioAsset {
    id: string;
    name: string | null;
    audioType: 'music' | 'sfx';
    prompt: string;
    fileUrl: string | null;
    durationSeconds: number | null;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    usageCount: number;
    createdAt: string;
    source?: 'generated' | 'uploaded';
}

interface AudioAssetCardProps {
    asset: AudioAsset;
    onSelect?: (asset: AudioAsset) => void;
    onDelete?: (assetId: string) => void;
    isSelectable?: boolean;
    isSelected?: boolean;
}

export function AudioAssetCard({
    asset,
    onSelect,
    onDelete,
    isSelectable = false,
    isSelected = false,
}: AudioAssetCardProps) {
    const [isPlaying, setIsPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const handlePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!asset.fileUrl) return;

        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
            setIsPlaying(!isPlaying);
        }
    };

    const handleAudioEnded = () => {
        setIsPlaying(false);
    };

    const formatDuration = (seconds: number | null) => {
        if (!seconds) return '--:--';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const displayName = asset.name || asset.prompt.slice(0, 40) + (asset.prompt.length > 40 ? '...' : '');

    return (
        <Card
            className={cn(
                'group relative overflow-hidden transition-all hover:shadow-md',
                isSelectable && 'cursor-pointer hover:ring-2 hover:ring-primary/50',
                isSelected && 'ring-2 ring-primary',
            )}
            onClick={() => isSelectable && onSelect?.(asset)}
        >
            <CardContent className="p-4">
                {/* Hidden audio element */}
                {asset.fileUrl && (
                    <audio
                        ref={audioRef}
                        src={asset.fileUrl}
                        onEnded={handleAudioEnded}
                        preload="metadata"
                    />
                )}

                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                            asset.audioType === 'music'
                                ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                                : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400'
                        )}>
                            {asset.audioType === 'music' ? (
                                <Music className="h-4 w-4" />
                            ) : (
                                <Volume2 className="h-4 w-4" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-medium truncate">{displayName}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                <Badge variant="secondary" className="text-xs capitalize">
                                    {asset.audioType}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                    {formatDuration(asset.durationSeconds)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Actions Dropdown */}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <MoreVertical className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => navigator.clipboard.writeText(asset.prompt)}>
                                <Copy className="h-4 w-4 mr-2" />
                                Copy Prompt
                            </DropdownMenuItem>
                            {asset.fileUrl && (
                                <DropdownMenuItem asChild>
                                    <a href={asset.fileUrl} download>
                                        <Download className="h-4 w-4 mr-2" />
                                        Download
                                    </a>
                                </DropdownMenuItem>
                            )}
                            {onDelete && (
                                <DropdownMenuItem
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onDelete(asset.id);
                                    }}
                                    className="text-destructive"
                                >
                                    <Trash2 className="h-4 w-4 mr-2" />
                                    Delete
                                </DropdownMenuItem>
                            )}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {/* Waveform / Play Area */}
                <div className="relative h-12 bg-muted/50 rounded-lg flex items-center justify-center mb-3">
                    {asset.status === 'completed' && asset.fileUrl ? (
                        <>
                            {/* Simple waveform placeholder */}
                            <div className="absolute inset-0 px-3 flex items-center gap-0.5">
                                {Array.from({ length: 40 }).map((_, i) => (
                                    <div
                                        key={i}
                                        className={cn(
                                            'w-1 rounded-full transition-colors',
                                            isPlaying ? 'bg-primary' : 'bg-muted-foreground/30',
                                        )}
                                        style={{
                                            height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 10}%`,
                                        }}
                                    />
                                ))}
                            </div>
                            {/* Play button overlay */}
                            <Button
                                variant="secondary"
                                size="icon"
                                className="relative z-10 h-8 w-8 rounded-full"
                                onClick={handlePlayPause}
                            >
                                {isPlaying ? (
                                    <Pause className="h-4 w-4" />
                                ) : (
                                    <Play className="h-4 w-4 ml-0.5" />
                                )}
                            </Button>
                        </>
                    ) : (
                        <Badge
                            variant={
                                asset.status === 'pending' ? 'secondary' :
                                    asset.status === 'processing' ? 'default' :
                                        'destructive'
                            }
                        >
                            {asset.status === 'processing' ? 'Generating...' : asset.status}
                        </Badge>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Used {asset.usageCount}x</span>
                    <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                </div>
            </CardContent>
        </Card>
    );
}
