'use client';

/**
 * Media Bin — left sidebar for browsing episode assets.
 *
 * Stub implementation. Will be populated with:
 * - Shots, Dialogue, Dubbed, Music, SFX, Uploads sections
 * - Drag-to-timeline support
 * - Upload handler
 * - Search/filter
 */

export function MediaBin() {
    return (
        <div className="flex h-full flex-col bg-zinc-900">
            <div className="border-b border-zinc-800 px-3 py-2.5">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Media Bin
                </h3>
            </div>

            <div className="flex-1 overflow-y-auto py-1">
                <MediaSection icon="🎬" label="Shots" count={0} />
                <MediaSection icon="🗣" label="Dialogue" count={0} />
                <MediaSection icon="🌐" label="Dubbed" count={0} />
                <MediaSection icon="🎵" label="Music" count={0} />
                <MediaSection icon="🔊" label="SFX" count={0} />
                <MediaSection icon="📁" label="Uploads" count={0} />
            </div>
        </div>
    );
}

function MediaSection({ icon, label, count }: { icon: string; label: string; count: number }) {
    return (
        <div className="flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-zinc-800">
            <span className="text-base">{icon}</span>
            <span className="flex-1 text-[13px] text-zinc-300">{label}</span>
            <span className="rounded-lg bg-zinc-800 px-1.5 py-px text-[11px] text-zinc-500">{count}</span>
        </div>
    );
}
