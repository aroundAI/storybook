'use client';

import { useMemo, useState, useTransition } from 'react';

import { Download, Filter, Play, PlusCircle, Search, X } from 'lucide-react';

import type { EpisodeWithShots, Shot, ShotStatus } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { ShotCard } from './shot-card';
import { ShotDetailsSidebar } from './shot-details-sidebar';

/**
 * VEO export data structure
 */
interface VeoExportData {
  episodeId: string;
  episodeTitle: string;
  exportedAt: string;
  totalShots: number;
  shots: Array<{
    sequenceNumber: number;
    sceneNumber: number;
    shotNumber: number;
    duration: number;
    prompt: string;
    veoPrompt?: {
      subject: string;
      action: string;
      scene: string;
      style: string;
      dialogue?: string;
      sounds: string;
      negativePrompt: string;
      fullPrompt: string;
    };
    referenceImages?: {
      characters: Array<{ name: string; url: string }>;
      locations: Array<{ name: string; url: string }>;
    };
    dialogueTiming?: Array<{
      startSeconds: number;
      durationSeconds: number;
      characterName: string;
      text: string;
      emotion: string | null;
    }>;
  }>;
  referenceImages: {
    characters: Array<{ name: string; url: string }>;
    locations: Array<{ name: string; url: string }>;
  };
}

interface VisualStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

interface ShotFilter {
  sceneNumber?: number;
  status?: ShotStatus;
  searchQuery?: string;
}

// Helper to determine shot size for comic strip layout
function getShotSize(index: number): 'lg' | 'md' | 'sm' {
  // First shot of each scene is large (spans 2 columns)
  if (index === 0) return 'lg';

  // Every 4th shot is medium
  if (index % 4 === 1) return 'md';

  // Alternate between md and sm for variety
  return index % 2 === 0 ? 'md' : 'sm';
}

export function VisualStudioScreen({
  episode,
  refetchEpisode,
}: VisualStudioScreenProps) {
  const [_isPending, _startTransition] = useTransition();
  const [filter, setFilter] = useState<ShotFilter>({});
  const [selectedShot, setSelectedShot] = useState<Shot | null>(null);

  const shots = episode.shots;

  // Get unique scene numbers for filter
  const sceneNumbers = useMemo(() => {
    const numbers = [...new Set(shots.map((s) => s.sceneNumber))];
    return numbers.sort((a, b) => a - b);
  }, [shots]);

  // Apply filters
  const filteredShots = useMemo(() => {
    return shots.filter((shot) => {
      if (filter.sceneNumber && shot.sceneNumber !== filter.sceneNumber) {
        return false;
      }
      if (filter.status && shot.status !== filter.status) {
        return false;
      }
      if (filter.searchQuery) {
        const query = filter.searchQuery.toLowerCase();
        const matchesPrompt = shot.prompt?.toLowerCase().includes(query);
        const matchesDescription = shot.description
          .toLowerCase()
          .includes(query);
        return matchesPrompt || matchesDescription;
      }
      return true;
    });
  }, [shots, filter]);

  // Group shots by scene
  const shotsByScene = useMemo(() => {
    const grouped: Record<number, Shot[]> = {};
    filteredShots.forEach((shot) => {
      const sceneNum = shot.sceneNumber;
      if (!grouped[sceneNum]) {
        grouped[sceneNum] = [];
      }
      grouped[sceneNum]!.push(shot);
    });
    return grouped;
  }, [filteredShots]);

  // Stats
  const stats = useMemo(() => {
    const total = shots.length;
    const pending = shots.filter((s) => s.status === 'pending').length;
    const generating = shots.filter((s) => s.status === 'generating').length;
    const completed = shots.filter((s) => s.status === 'completed').length;
    const failed = shots.filter((s) => s.status === 'failed').length;
    const totalDuration = shots.reduce((acc, s) => acc + s.duration, 0);
    return { total, pending, generating, completed, failed, totalDuration };
  }, [shots]);

  const handleGenerateAll = () => {
    const pendingShots = shots.filter((s) => s.status === 'pending');
    if (pendingShots.length === 0) {
      toast.warning('No pending shots to generate');
      return;
    }
    toast.info(`Queued ${pendingShots.length} shots for video generation`);
    // TODO: Integrate with video generation action
  };

  /**
   * Export all shot data for VEO 3.1 manual generation workflow
   * Downloads JSON with prompts, reference images, and dialogue timing
   */
  const handleExportVeo = () => {
    if (shots.length === 0) {
      toast.warning('No shots to export');
      return;
    }

    // Collect all unique reference images across shots
    const allCharacterImages = new Map<string, { name: string; url: string }>();
    const allLocationImages = new Map<string, { name: string; url: string }>();

    const exportShots = shots.map((shot) => {
      // Extract VEO data from shot metadata
      const metadata = shot.metadata as {
        veoPrompt?: {
          subject: string;
          action: string;
          scene: string;
          style: string;
          dialogue?: string;
          sounds: string;
          negativePrompt: string;
          fullPrompt: string;
        };
        referenceImages?: {
          characters: Array<{ name: string; url: string }>;
          locations: Array<{ name: string; url: string }>;
        };
        dialogueTiming?: Array<{
          startSeconds: number;
          durationSeconds: number;
          characterName: string;
          text: string;
          emotion: string | null;
        }>;
      } | null;

      // Aggregate reference images
      if (metadata?.referenceImages?.characters) {
        for (const img of metadata.referenceImages.characters) {
          allCharacterImages.set(img.name, img);
        }
      }
      if (metadata?.referenceImages?.locations) {
        for (const img of metadata.referenceImages.locations) {
          allLocationImages.set(img.name, img);
        }
      }

      return {
        sequenceNumber: shot.sequenceNumber ?? shot.shotNumber,
        sceneNumber: shot.sceneNumber,
        shotNumber: shot.shotNumber,
        duration: shot.duration,
        prompt: shot.prompt ?? '',
        veoPrompt: metadata?.veoPrompt,
        referenceImages: metadata?.referenceImages,
        dialogueTiming: metadata?.dialogueTiming,
      };
    });

    const exportData: VeoExportData = {
      episodeId: episode.id,
      episodeTitle: episode.title,
      exportedAt: new Date().toISOString(),
      totalShots: shots.length,
      shots: exportShots,
      referenceImages: {
        characters: Array.from(allCharacterImages.values()),
        locations: Array.from(allLocationImages.values()),
      },
    };

    // Create and download JSON file
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `veo-export-${episode.title.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast.success(`Exported ${shots.length} shots for VEO 3.1`);
  };

  return (
    <div className="relative h-full">
      {/* Main Content - Full width always */}
      <div className="flex h-full flex-col overflow-hidden">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-black/5 bg-white/85 px-6 py-3 backdrop-blur-xl dark:border-white/5 dark:bg-gray-800/85">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-gray-900 dark:text-white">
              Visual Studio
            </h2>
            <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span>{stats.total} shots</span>
              <span>•</span>
              <span>~{Math.round(stats.totalDuration / 60)} min</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 text-xs">
              <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
                {stats.pending} pending
              </span>
              {stats.generating > 0 && (
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                  {stats.generating} generating
                </span>
              )}
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                {stats.completed} completed
              </span>
              {stats.failed > 0 && (
                <span className="rounded-full bg-red-100 px-2 py-0.5 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  {stats.failed} failed
                </span>
              )}
            </div>

            <Button
              variant="outline"
              onClick={handleExportVeo}
              disabled={stats.total === 0}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              Export VEO
            </Button>

            <Button
              onClick={handleGenerateAll}
              disabled={stats.pending === 0}
              className="gap-2 bg-blue-600 text-white shadow-lg shadow-blue-500/20 hover:bg-blue-700"
            >
              <Play className="h-4 w-4" />
              Generate All Pending
            </Button>
          </div>
        </div>

        {/* Filters Bar */}
        <div className="flex items-center gap-4 border-b border-black/5 bg-white/50 px-6 py-3 backdrop-blur-sm dark:border-white/5 dark:bg-gray-800/50">
          {/* Search */}
          <div className="relative max-w-xs flex-1">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Filter shots..."
              value={filter.searchQuery ?? ''}
              onChange={(e) =>
                setFilter({
                  ...filter,
                  searchQuery: e.target.value || undefined,
                })
              }
              className="pl-9"
            />
          </div>

          {/* Scene Filter */}
          <Select
            value={filter.sceneNumber?.toString() ?? 'all'}
            onValueChange={(value) =>
              setFilter({
                ...filter,
                sceneNumber: value === 'all' ? undefined : parseInt(value, 10),
              })
            }
          >
            <SelectTrigger className="w-36">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Scene" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Scenes</SelectItem>
              {sceneNumbers.map((num) => (
                <SelectItem key={num} value={num.toString()}>
                  Scene {num}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select
            value={filter.status ?? 'all'}
            onValueChange={(value) =>
              setFilter({
                ...filter,
                status: value === 'all' ? undefined : (value as ShotStatus),
              })
            }
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="generating">Generating</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {(filter.sceneNumber || filter.status || filter.searchQuery) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setFilter({})}
              className="text-gray-500"
            >
              <X className="mr-1 h-4 w-4" />
              Clear
            </Button>
          )}
        </div>

        {/* Comic Strip Shot Grid */}
        <div className="flex-1 overflow-y-auto p-8">
          {Object.entries(shotsByScene).length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              No shots match the current filters
            </div>
          ) : (
            <div className="space-y-12">
              {Object.entries(shotsByScene)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([sceneNum, sceneShots]) => (
                  <div key={sceneNum} className="flex items-start gap-6">
                    {/* Rotated Scene Title */}
                    <div className="scene-title-rotator sticky top-8 flex h-[250px] min-w-[40px] items-center justify-center">
                      Scene {sceneNum}
                    </div>

                    {/* Comic Strip Grid */}
                    <div className="grid flex-1 auto-rows-min grid-cols-2 gap-8 md:grid-cols-3 lg:grid-cols-4">
                      {sceneShots.map((shot, index) => (
                        <ShotCard
                          key={shot.id}
                          shot={shot}
                          size={getShotSize(index)}
                          isSelected={selectedShot?.id === shot.id}
                          onClick={() => setSelectedShot(shot)}
                        />
                      ))}

                      {/* Add New Shot Card */}
                      <div className="liquid-card flex min-h-[200px] cursor-pointer flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-50/50 p-4 text-gray-500 transition-colors hover:bg-gray-100/50 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:bg-gray-700/50">
                        <PlusCircle className="mb-2 h-10 w-10" />
                        <span className="text-sm font-medium">
                          Add New Shot
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Fixed Sidebar Overlay */}
      {selectedShot && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-20 bg-black/10"
            onClick={() => setSelectedShot(null)}
          />

          {/* Sidebar */}
          <div className="fixed top-0 right-0 z-30 h-full">
            <ShotDetailsSidebar
              shot={selectedShot}
              onClose={() => setSelectedShot(null)}
              onUpdate={refetchEpisode}
            />
          </div>
        </>
      )}
    </div>
  );
}
