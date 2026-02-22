'use client';

/**
 * Media Bin — left sidebar panel for browsing episode assets.
 *
 * Shows collapsible sections for Shots, Dialogue, Dubbed, Music, SFX,
 * Ambient, and Uploads. Each asset is draggable onto the timeline.
 *
 * Features:
 * - Real data fetched via `useMediaBin` hook
 * - Text search filter across all sections
 * - "On timeline" (✓) indicator for placed assets
 * - Drag-to-timeline with structured clip data
 */

import { useMemo, useState } from 'react';

import { useEditSuite } from '../edit-suite-provider';
import { useMediaBin } from '../../hooks/use-media-bin';
import { AssetGroup } from './asset-group';
import { AssetItem } from './asset-item';

export function MediaBin() {
    const { state } = useEditSuite();
    const episodeId = state.project?.episodeId ?? undefined;
    const { sections, isLoading, error, refetch } = useMediaBin(episodeId, state);
    const [search, setSearch] = useState('');

    // Filter assets by search term
    const filteredSections = useMemo(() => {
        if (!search.trim()) return sections;
        const q = search.toLowerCase();
        return sections
            .map((section) => ({
                ...section,
                assets: section.assets.filter((a) => a.name.toLowerCase().includes(q)),
            }))
            .filter((section) => section.assets.length > 0);
    }, [sections, search]);

    // Total asset count
    const totalCount = sections.reduce((sum, s) => sum + s.assets.length, 0);

    return (
        <div className="flex h-full flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Media
                </h3>
                <span className="text-[10px] text-zinc-500">{totalCount} assets</span>
            </div>

            {/* Search */}
            <div className="border-b border-zinc-800 px-3 py-2">
                <input
                    type="text"
                    placeholder="Search assets…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-md border border-zinc-700 bg-zinc-800/50 px-2.5 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500/30"
                />
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {isLoading && (
                    <div className="flex items-center justify-center py-12 text-sm text-zinc-500">
                        <span className="animate-pulse">Loading assets…</span>
                    </div>
                )}

                {error && (
                    <div className="px-3 py-4">
                        <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-xs text-red-400">
                            {error}
                        </div>
                        <button
                            onClick={refetch}
                            className="mt-2 text-xs text-violet-400 hover:text-violet-300"
                        >
                            Retry
                        </button>
                    </div>
                )}

                {!isLoading && !error && filteredSections.length === 0 && (
                    <div className="px-3 py-8 text-center text-xs text-zinc-500">
                        {search ? 'No matching assets' : 'No assets found for this episode'}
                    </div>
                )}

                {filteredSections.map((section) => (
                    <AssetGroup
                        key={section.key}
                        icon={section.icon}
                        label={section.label}
                        count={section.assets.length}
                    >
                        {section.assets.map((asset) => (
                            <AssetItem key={asset.id} asset={asset} />
                        ))}
                    </AssetGroup>
                ))}
            </div>
        </div>
    );
}
