'use client';

import { useMemo, useState, useTransition } from 'react';

import { Filter, Play, Search, X } from 'lucide-react';

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

interface VisualStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

interface ShotFilter {
  sceneNumber?: number;
  status?: ShotStatus;
  searchQuery?: string;
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

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
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
              placeholder="Search shots..."
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

        {/* Shot Grid */}
        <div className="flex-1 overflow-y-auto p-6">
          {Object.entries(shotsByScene).length === 0 ? (
            <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
              No shots match the current filters
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(shotsByScene)
                .sort(([a], [b]) => parseInt(a) - parseInt(b))
                .map(([sceneNum, sceneShots]) => (
                  <div key={sceneNum}>
                    {/* Scene Header */}
                    <div className="mb-4 flex items-center gap-3">
                      <h3 className="text-sm font-bold tracking-wider text-gray-400 uppercase dark:text-gray-500">
                        Scene {sceneNum}
                      </h3>
                      <div className="h-px flex-1 bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {sceneShots.length} shot
                        {sceneShots.length !== 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Shot Cards Grid */}
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
                      {sceneShots.map((shot) => (
                        <ShotCard
                          key={shot.id}
                          shot={shot}
                          isSelected={selectedShot?.id === shot.id}
                          onClick={() => setSelectedShot(shot)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Shot Details Sidebar */}
      {selectedShot && (
        <ShotDetailsSidebar
          shot={selectedShot}
          onClose={() => setSelectedShot(null)}
          onUpdate={refetchEpisode}
        />
      )}
    </div>
  );
}
