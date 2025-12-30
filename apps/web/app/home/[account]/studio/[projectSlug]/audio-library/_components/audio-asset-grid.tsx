'use client';

/**
 * AudioAssetGrid Component
 * 
 * Grid view of audio assets with search, filter, and empty state.
 */

import { useState } from 'react';
import { Search, Music, Volume2, Loader2, Sparkles } from 'lucide-react';

import { Input } from '@kit/ui/input';
import { Button } from '@kit/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import { AudioAssetCard, type AudioAsset } from './audio-asset-card';

interface AudioAssetGridProps {
    assets: AudioAsset[];
    isLoading?: boolean;
    onSelect?: (asset: AudioAsset) => void;
    onDelete?: (assetId: string) => void;
    onGenerate?: () => void;
    onUpload?: () => void;
    isSelectable?: boolean;
    selectedAssetId?: string;
}

export function AudioAssetGrid({
    assets,
    isLoading = false,
    onSelect,
    onDelete,
    onGenerate,
    onUpload,
    isSelectable = false,
    selectedAssetId,
}: AudioAssetGridProps) {
    const [search, setSearch] = useState('');
    const [activeTab, setActiveTab] = useState<'all' | 'music' | 'sfx'>('all');
    const [statusFilter, setStatusFilter] = useState<'all' | 'completed' | 'pending'>('all');

    // Filter assets
    const filteredAssets = assets.filter((asset) => {
        // Search filter
        const searchLower = search.toLowerCase();
        const matchesSearch =
            !search ||
            asset.name?.toLowerCase().includes(searchLower) ||
            asset.prompt.toLowerCase().includes(searchLower);

        // Type filter
        const matchesType = activeTab === 'all' || asset.audioType === activeTab;

        // Status filter
        const matchesStatus =
            statusFilter === 'all' ||
            (statusFilter === 'completed' && asset.status === 'completed') ||
            (statusFilter === 'pending' && ['pending', 'processing'].includes(asset.status));

        return matchesSearch && matchesType && matchesStatus;
    });

    // Count by type
    const musicCount = assets.filter((a) => a.audioType === 'music').length;
    const sfxCount = assets.filter((a) => a.audioType === 'sfx').length;

    return (
        <div className="space-y-4">
            {/* Filter Bar */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
                    <TabsList>
                        <TabsTrigger value="all">
                            All ({assets.length})
                        </TabsTrigger>
                        <TabsTrigger value="music" className="gap-1.5">
                            <Music className="h-3.5 w-3.5" />
                            Music ({musicCount})
                        </TabsTrigger>
                        <TabsTrigger value="sfx" className="gap-1.5">
                            <Volume2 className="h-3.5 w-3.5" />
                            SFX ({sfxCount})
                        </TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1 sm:w-64">
                        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            placeholder="Search by name or prompt..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="pl-8"
                        />
                    </div>
                    {onGenerate && (
                        <Button onClick={onGenerate} className="gap-1.5">
                            <Sparkles className="h-4 w-4" />
                            Generate
                        </Button>
                    )}
                </div>
            </div>

            {/* Loading State */}
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {/* Empty State */}
            {!isLoading && filteredAssets.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        {activeTab === 'sfx' ? (
                            <Volume2 className="h-8 w-8 text-muted-foreground" />
                        ) : (
                            <Music className="h-8 w-8 text-muted-foreground" />
                        )}
                    </div>
                    <h3 className="mb-1 text-lg font-semibold">
                        {search ? 'No matching assets' : 'No audio assets yet'}
                    </h3>
                    <p className="mb-4 text-sm text-muted-foreground max-w-sm">
                        {search
                            ? 'Try a different search term'
                            : 'Generate AI music & SFX or upload your own audio files'}
                    </p>
                    {!search && (
                        <div className="flex gap-2">
                            {onGenerate && (
                                <Button onClick={onGenerate}>
                                    <Sparkles className="h-4 w-4 mr-1.5" />
                                    Generate
                                </Button>
                            )}
                            {onUpload && (
                                <Button variant="outline" onClick={onUpload}>
                                    Upload
                                </Button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Grid */}
            {!isLoading && filteredAssets.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredAssets.map((asset) => (
                        <AudioAssetCard
                            key={asset.id}
                            asset={asset}
                            onSelect={onSelect}
                            onDelete={onDelete}
                            isSelectable={isSelectable}
                            isSelected={selectedAssetId === asset.id}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
