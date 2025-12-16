'use client';

import { CheckCheck, Copy, Loader2, Sparkles, X } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { cn } from '@kit/ui/utils';

import type { VideoProvider } from '../../lib/types';
import {
  PROVIDER_OPTIONS,
  QUALITY_OPTIONS,
  type QualityMode,
  type VisualStudioHeaderProps,
} from './types';

export function VisualStudioHeader({
  selectedShotIds,
  totalShots,
  provider,
  mode,
  onProviderChange,
  onModeChange,
  onSelectAll,
  onDeselectAll,
  onGenerate,
  onCopyAllPrompts,
  isGenerating,
}: VisualStudioHeaderProps) {
  const hasSelection = selectedShotIds.length > 0;
  const allSelected = selectedShotIds.length === totalShots && totalShots > 0;

  return (
    <div className="flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold">Visual Studio</h2>

        {hasSelection && (
          <span className="text-muted-foreground text-sm">
            {selectedShotIds.length} of {totalShots} selected
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        {/* Provider Selection */}
        <Select
          value={provider}
          onValueChange={(value) => onProviderChange(value as VideoProvider)}
        >
          <SelectTrigger
            className="w-[140px]"
            aria-label="Select video provider"
          >
            <SelectValue placeholder="Provider" />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Quality Mode */}
        <Select
          value={mode}
          onValueChange={(value) => onModeChange(value as QualityMode)}
        >
          <SelectTrigger className="w-[130px]" aria-label="Select quality mode">
            <SelectValue placeholder="Quality" />
          </SelectTrigger>
          <SelectContent>
            {QUALITY_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Selection Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onSelectAll}
            disabled={allSelected || totalShots === 0}
            aria-label="Select all shots"
          >
            <CheckCheck className="mr-1 h-4 w-4" />
            All
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onDeselectAll}
            disabled={!hasSelection}
            aria-label="Deselect all shots"
          >
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        </div>

        {/* Copy All Prompts Button */}
        {onCopyAllPrompts && totalShots > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={onCopyAllPrompts}
            aria-label="Copy all prompts to clipboard"
          >
            <Copy className="mr-1 h-4 w-4" />
            Copy Prompts
          </Button>
        )}

        {/* Generate Button */}
        <Button
          onClick={onGenerate}
          disabled={!hasSelection || isGenerating}
          className={cn(
            'min-w-[120px]',
            hasSelection && 'bg-primary hover:bg-primary/90',
          )}
          aria-label={`Generate ${selectedShotIds.length} selected videos`}
          aria-busy={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Sparkles className="mr-2 h-4 w-4" />
              Generate ({selectedShotIds.length})
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
