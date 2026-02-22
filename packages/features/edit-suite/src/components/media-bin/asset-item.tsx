'use client';

/**
 * AssetItem — individual media asset in the Media Bin.
 *
 * Displays thumbnail (or icon fallback), name, duration badge.
 * Draggable — sets clip data in `dataTransfer` for timeline drops.
 * Shows ✅ indicator for assets already on the timeline.
 */

import type { MediaAsset, DragClipData } from '../../hooks/use-media-bin';

/** Drag data MIME type constant */
export const DRAG_CLIP_MIME = 'application/x-edit-suite-clip';

// ──────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────

function formatDuration(seconds: number): string {
    if (seconds < 1) return '<1s';
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

const TYPE_ICON: Record<string, string> = {
    shot: '🎬',
    dialogue: '🗣',
    dubbed: '🌐',
    music: '🎵',
    sfx: '🔊',
    ambient: '🌿',
    upload: '📁',
};

// ──────────────────────────────────────────
// Component
// ──────────────────────────────────────────

interface AssetItemProps {
    asset: MediaAsset;
    onSelect?: (asset: MediaAsset) => void;
}

export function AssetItem({ asset, onSelect }: AssetItemProps) {
    const handleDragStart = (e: React.DragEvent) => {
        const clipData: DragClipData = {
            assetId: asset.id,
            type: asset.type,
            name: asset.name,
            mediaUrl: asset.mediaUrl,
            thumbnailUrl: asset.thumbnailUrl,
            durationMs: Math.round(asset.durationSeconds * 1000),
            meta: asset.meta,
        };

        e.dataTransfer.setData(DRAG_CLIP_MIME, JSON.stringify(clipData));
        e.dataTransfer.effectAllowed = 'copy';
    };

    return (
        <div
            className="group flex cursor-grab items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-zinc-800/60 active:cursor-grabbing"
            draggable
            onDragStart={handleDragStart}
            onClick={() => onSelect?.(asset)}
            role="option"
            aria-selected={false}
            tabIndex={0}
        >
            {/* Thumbnail or icon */}
            {asset.thumbnailUrl ? (
                <img
                    src={asset.thumbnailUrl}
                    alt={asset.name}
                    className="h-8 w-12 flex-shrink-0 rounded object-cover"
                    loading="lazy"
                />
            ) : (
                <span className="flex h-8 w-12 flex-shrink-0 items-center justify-center rounded bg-zinc-800 text-base">
                    {TYPE_ICON[asset.type] ?? '📄'}
                </span>
            )}

            {/* Name */}
            <span className="min-w-0 flex-1 truncate text-zinc-300 group-hover:text-zinc-100">
                {asset.name}
            </span>

            {/* On timeline indicator */}
            {asset.isOnTimeline && (
                <span className="text-[11px] text-emerald-500" title="On timeline">✓</span>
            )}

            {/* Duration badge */}
            <span className="flex-shrink-0 text-[11px] text-zinc-500">
                {formatDuration(asset.durationSeconds)}
            </span>
        </div>
    );
}
