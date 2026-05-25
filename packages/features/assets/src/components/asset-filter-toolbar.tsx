'use client';

import { useState } from 'react';

import { SlidersHorizontal, X } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';
import { cn } from '@kit/ui/utils';

import type {
  CharacterFilters,
  ElementPromptStatus,
  ImageStatus,
  SortOption,
  VoiceStatus,
} from '../hooks/use-character-filters';
import type { CharacterRole } from '../lib/types';
import { AssetSearchBar } from './asset-search-bar';

const ALL_ROLES: { value: CharacterRole; label: string }[] = [
  { value: 'protagonist', label: 'Protagonist' },
  { value: 'deuteragonist', label: 'Deuteragonist' },
  { value: 'supporting', label: 'Supporting' },
  { value: 'narrator', label: 'Narrator' },
  { value: 'creature', label: 'Creature' },
  { value: 'object', label: 'Object' },
  { value: 'background', label: 'Background' },
];

const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'role-priority', label: 'Role Priority' },
  { value: 'name-asc', label: 'Name (A-Z)' },
  { value: 'name-desc', label: 'Name (Z-A)' },
  { value: 'created-desc', label: 'Recently Created' },
  { value: 'updated-desc', label: 'Recently Updated' },
];

interface AssetFilterToolbarProps {
  filters: CharacterFilters;
  activeFilterCount: number;
  resultCount: number;
  totalCount: number;
  onSearchChange: (value: string) => void;
  onRoleToggle: (role: CharacterRole) => void;
  onVoiceStatusChange: (status: VoiceStatus) => void;
  onImageStatusChange: (status: ImageStatus) => void;
  onElementPromptStatusChange: (status: ElementPromptStatus) => void;
  onSortChange: (sort: SortOption) => void;
  onClearFilters: () => void;
}

export function AssetFilterToolbar({
  filters,
  activeFilterCount,
  resultCount,
  totalCount,
  onSearchChange,
  onRoleToggle,
  onVoiceStatusChange,
  onImageStatusChange,
  onElementPromptStatusChange,
  onSortChange,
  onClearFilters,
}: AssetFilterToolbarProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="space-y-3">
      {/* Search + Filter Toggle Row */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <AssetSearchBar
            value={filters.search}
            onChange={onSearchChange}
            placeholder="Search characters..."
          />
        </div>

        <Button
          variant={isExpanded ? 'secondary' : 'outline'}
          size="sm"
          className="relative shrink-0"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <SlidersHorizontal className="mr-1.5 h-4 w-4" />
          Filters
          {activeFilterCount > 0 && (
            <Badge
              variant="destructive"
              className="ml-1.5 h-5 min-w-5 rounded-full px-1.5 text-[10px]"
            >
              {activeFilterCount}
            </Badge>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="text-muted-foreground shrink-0"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Expanded Filter Panel */}
      {isExpanded && (
        <div className="bg-muted/50 animate-in fade-in slide-in-from-top-2 space-y-4 rounded-lg border p-4 duration-200">
          {/* Role Filter */}
          <div className="space-y-2">
            <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
              Role
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_ROLES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onRoleToggle(value)}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    filters.roles.includes(value)
                      ? 'border-orange-500/50 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'
                      : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Status Filters Row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Voice Status */}
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Voice
              </label>
              <ToggleGroup
                type="single"
                value={filters.voiceStatus}
                onValueChange={(val) =>
                  val && onVoiceStatusChange(val as VoiceStatus)
                }
                className="justify-start"
              >
                <ToggleGroupItem value="all" size="sm" className="text-xs">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="has-voice"
                  size="sm"
                  className="text-xs"
                >
                  Has Voice
                </ToggleGroupItem>
                <ToggleGroupItem value="no-voice" size="sm" className="text-xs">
                  No Voice
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Image Status */}
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                Image
              </label>
              <ToggleGroup
                type="single"
                value={filters.imageStatus}
                onValueChange={(val) =>
                  val && onImageStatusChange(val as ImageStatus)
                }
                className="justify-start"
              >
                <ToggleGroupItem value="all" size="sm" className="text-xs">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="has-image"
                  size="sm"
                  className="text-xs"
                >
                  Has Image
                </ToggleGroupItem>
                <ToggleGroupItem value="no-image" size="sm" className="text-xs">
                  No Image
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Element Prompt Status */}
            <div className="space-y-2">
              <label className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                VEO Ready
              </label>
              <ToggleGroup
                type="single"
                value={filters.elementPromptStatus}
                onValueChange={(val) =>
                  val && onElementPromptStatusChange(val as ElementPromptStatus)
                }
                className="justify-start"
              >
                <ToggleGroupItem value="all" size="sm" className="text-xs">
                  All
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="has-prompt"
                  size="sm"
                  className="text-xs"
                >
                  Ready
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="no-prompt"
                  size="sm"
                  className="text-xs"
                >
                  Missing
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {/* Sort + Result Count */}
          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-2">
              <label className="text-muted-foreground text-xs font-medium">
                Sort by
              </label>
              <Select
                value={filters.sortBy}
                onValueChange={(val) => onSortChange(val as SortOption)}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <span className="text-muted-foreground text-xs">
              Showing{' '}
              <span className="text-foreground font-medium">{resultCount}</span>{' '}
              of {totalCount} characters
            </span>
          </div>
        </div>
      )}

      {/* Collapsed Summary */}
      {!isExpanded && activeFilterCount > 0 && (
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <span>
            Showing{' '}
            <span className="text-foreground font-medium">{resultCount}</span>{' '}
            of {totalCount} characters
          </span>
          <span>·</span>
          <span>{activeFilterCount} filter(s) active</span>
        </div>
      )}
    </div>
  );
}
