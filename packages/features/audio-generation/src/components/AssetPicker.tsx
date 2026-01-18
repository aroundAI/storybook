'use client';

/**
 * AssetPicker Component
 *
 * Modal to browse and select audio assets from the library.
 * Used in Audio Studio to add music/SFX tracks from existing library.
 */
import { useEffect, useState } from 'react';

import { Check, Loader2, Music, Search, Volume2 } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { ScrollArea } from '@kit/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import { getAudioAssetsAction } from '../server/audio-asset-actions';

export interface PickerAudioAsset {
  id: string;
  name: string | null;
  audioType: 'music' | 'sfx';
  prompt: string;
  fileUrl: string | null;
  durationSeconds: number | null;
  usageCount: number;
}

interface AssetPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (asset: PickerAudioAsset) => void;
  audioType?: 'music' | 'sfx' | 'all';
  projectId: string;
  title?: string;
  description?: string;
}

export function AssetPicker({
  open,
  onOpenChange,
  onSelect,
  audioType = 'all',
  projectId,
  title = 'Select from Library',
  description = 'Choose an existing audio asset',
}: AssetPickerProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'music' | 'sfx'>(
    audioType === 'all' ? 'all' : audioType,
  );
  const [isLoading, setIsLoading] = useState(true);
  const [assets, setAssets] = useState<PickerAudioAsset[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [_playingId, _setPlayingId] = useState<string | null>(null);

  // Fetch assets when dialog opens
  useEffect(() => {
    if (open) {
      fetchAssets();
    }
  }, [open, projectId]);

  const fetchAssets = async () => {
    setIsLoading(true);
    try {
      const result = await getAudioAssetsAction({
        projectId,
        status: 'completed',
        limit: 100,
        offset: 0,
      });

      const mappedAssets: PickerAudioAsset[] = result.assets.map((asset) => ({
        id: asset.id,
        name: asset.name,
        audioType: asset.audioType,
        prompt: asset.prompt,
        fileUrl: asset.fileUrl,
        durationSeconds: asset.durationSeconds,
        usageCount: asset.usageCount,
      }));

      setAssets(mappedAssets);
    } catch (error) {
      console.error('Failed to fetch assets:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Filter assets
  const filteredAssets = assets.filter((asset) => {
    const searchLower = search.toLowerCase();
    const matchesSearch =
      !search ||
      asset.name?.toLowerCase().includes(searchLower) ||
      asset.prompt.toLowerCase().includes(searchLower);

    const matchesType = activeTab === 'all' || asset.audioType === activeTab;

    return matchesSearch && matchesType;
  });

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSelect = () => {
    const selected = assets.find((a) => a.id === selectedId);
    if (selected) {
      onSelect(selected);
      onOpenChange(false);
      setSelectedId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Music className="text-primary h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {/* Search and Filter */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2" />
              <Input
                placeholder="Search by name or prompt..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
            {audioType === 'all' && (
              <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as typeof activeTab)}
              >
                <TabsList>
                  <TabsTrigger value="all">All</TabsTrigger>
                  <TabsTrigger value="music">Music</TabsTrigger>
                  <TabsTrigger value="sfx">SFX</TabsTrigger>
                </TabsList>
              </Tabs>
            )}
          </div>

          {/* Asset List */}
          <ScrollArea className="-mx-6 flex-1 px-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="text-muted-foreground h-8 w-8 animate-spin" />
              </div>
            ) : filteredAssets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="bg-muted mb-4 flex h-12 w-12 items-center justify-center rounded-full">
                  {activeTab === 'sfx' ? (
                    <Volume2 className="text-muted-foreground h-6 w-6" />
                  ) : (
                    <Music className="text-muted-foreground h-6 w-6" />
                  )}
                </div>
                <p className="text-muted-foreground text-sm">
                  {search
                    ? 'No matching assets found'
                    : 'No audio assets in library yet'}
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredAssets.map((asset) => (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedId(asset.id)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                      selectedId === asset.id
                        ? 'border-primary bg-primary/5'
                        : 'bg-muted/50 hover:bg-muted border-transparent',
                    )}
                  >
                    {/* Icon */}
                    <div
                      className={cn(
                        'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                        asset.audioType === 'music'
                          ? 'bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400'
                          : 'bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400',
                      )}
                    >
                      {asset.audioType === 'music' ? (
                        <Music className="h-5 w-5" />
                      ) : (
                        <Volume2 className="h-5 w-5" />
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {asset.name || asset.prompt.slice(0, 40)}
                      </p>
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <Badge
                          variant="secondary"
                          className="text-xs capitalize"
                        >
                          {asset.audioType}
                        </Badge>
                        <span>{formatDuration(asset.durationSeconds)}</span>
                        <span>•</span>
                        <span>Used {asset.usageCount}x</span>
                      </div>
                    </div>

                    {/* Selected Check */}
                    {selectedId === asset.id && (
                      <Check className="text-primary h-5 w-5 shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSelect} disabled={!selectedId}>
            <Check className="mr-1.5 h-4 w-4" />
            Select
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
