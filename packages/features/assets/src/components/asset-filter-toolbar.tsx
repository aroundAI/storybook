'use client';

import { useCallback, useState } from 'react';

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

type StatusFilterValue = VoiceStatus | ImageStatus | ElementPromptStatus;

function StatusFilter<T extends StatusFilterValue>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (val: T) => void;
  options: { value: T; label: string }[];
}) {
  const handleClick = useCallback(
    (optionValue: T) => {
      if (optionValue !== value) {
        onChange(optionValue);
      }
    },
    [value, onChange],
  );

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
        {label}
      </label>
      <div className="flex items-center gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleClick(option.value)}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
              value === option.value
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
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
            className="shrink-0 text-muted-foreground"
          >
            <X className="mr-1 h-3.5 w-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* Expanded Filter Panel */}
      {isExpanded && (
        <div className="space-y-4 rounded-lg border bg-muted/50 p-4 duration-200 animate-in fade-in slide-in-from-top-2">
          {/* Role Filter */}
          <div className="space-y-2">
            <label className="text-xs font-medium tracking-wider text-muted-foreground uppercase">
              Role
            </label>
            <div className="flex flex-wrap gap-1.5">
              {ALL_ROLES.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
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
            <StatusFilter<VoiceStatus>
              label="Voice"
              value={filters.voiceStatus}
              onChange={onVoiceStatusChange}
              options={[
                { value: 'all', label: 'All' },
                { value: 'has-voice', label: 'Has Voice' },
                { value: 'no-voice', label: 'No Voice' },
              ]}
            />
            <StatusFilter<ImageStatus>
              label="Image"
              value={filters.imageStatus}
              onChange={onImageStatusChange}
              options={[
                { value: 'all', label: 'All' },
                { value: 'has-image', label: 'Has Image' },
                { value: 'no-image', label: 'No Image' },
              ]}
            />
            <StatusFilter<ElementPromptStatus>
              label="VEO Ready"
              value={filters.elementPromptStatus}
              onChange={onElementPromptStatusChange}
              options={[
                { value: 'all', label: 'All' },
                { value: 'has-prompt', label: 'Ready' },
                { value: 'no-prompt', label: 'Missing' },
              ]}
            />
          </div>

          {/* Sort + Result Count */}
          <div className="flex items-center justify-between border-t pt-3">
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-muted-foreground">
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

            <span className="text-xs text-muted-foreground">
              Showing{' '}
              <span className="font-medium text-foreground">{resultCount}</span>{' '}
              of {totalCount} characters
            </span>
          </div>
        </div>
      )}

      {/* Collapsed Summary */}
      {!isExpanded && activeFilterCount > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            Showing{' '}
            <span className="font-medium text-foreground">{resultCount}</span>{' '}
            of {totalCount} characters
          </span>
          <span>·</span>
          <span>{activeFilterCount} filter(s) active</span>
        </div>
      )}
    </div>
  );
}
