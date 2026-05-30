'use client';

import { Filter, Flame, Search, X } from 'lucide-react';

import type { ShotStatus } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { cn } from '@kit/ui/utils';

import type { ShotFilter } from './visual-studio-utils';

interface FilterBarProps {
  filter: ShotFilter;
  setFilter: (filter: ShotFilter) => void;
  sceneNumbers: number[];
  showShortsOnly: boolean;
  setShowShortsOnly: (fn: (v: boolean) => boolean) => void;
  shortsCandidateCount: number;
}

export function FilterBar({
  filter,
  setFilter,
  sceneNumbers,
  showShortsOnly,
  setShowShortsOnly,
  shortsCandidateCount,
}: FilterBarProps) {
  return (
    <div className="flex items-center gap-4 border-b border-white/5 bg-white/[0.02] px-6 py-3 backdrop-blur-sm">
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

      {/* Shorts Only Toggle */}
      {shortsCandidateCount > 0 && (
        <button
          onClick={() => setShowShortsOnly((v) => !v)}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-all',
            showShortsOnly
              ? 'border-orange-400 bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md'
              : 'border-gray-200 bg-white/5 text-gray-500 hover:border-orange-300 hover:text-orange-500 dark:border-white/10',
          )}
        >
          <Flame className="h-3.5 w-3.5" />
          Shorts Only
        </button>
      )}

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
  );
}
