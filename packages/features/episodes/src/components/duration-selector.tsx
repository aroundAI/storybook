'use client';

import { useMemo, useState } from 'react';

import { Clock, Film, MessageSquare, Zap } from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { cn } from '@kit/ui/utils';

import {
  type ContentStyle,
  DURATION_PRESETS,
  getScalingPreview,
} from '../lib/duration-scaling';

interface DurationSelectorProps {
  /** Currently selected duration in seconds */
  duration: number;
  /** Callback when duration changes */
  onDurationChange: (seconds: number) => void;
  /** Currently selected content style */
  contentStyle: ContentStyle;
  /** Callback when content style changes */
  onContentStyleChange: (style: ContentStyle) => void;
  /** Optional project default duration to show indicator */
  projectDefault?: number;
  /** Show compact version */
  compact?: boolean;
  /** Disable the selectors */
  disabled?: boolean;
  /** Optional class name */
  className?: string;
}

const CONTENT_STYLES: Array<{
  value: ContentStyle;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    value: 'dialogue-heavy',
    label: 'Dialogue Heavy',
    description: 'Kids cartoons, comedies, character-driven content',
    icon: MessageSquare,
  },
  {
    value: 'action-heavy',
    label: 'Action Heavy',
    description: 'Action sequences, chase scenes, visual storytelling',
    icon: Zap,
  },
  {
    value: 'balanced',
    label: 'Balanced',
    description: 'Mixed dialogue and action, dramas, documentaries',
    icon: Film,
  },
];

/**
 * Duration selector component for story generation
 *
 * Allows users to:
 * - Select target episode duration from presets
 * - Choose content style (affects dialogue density)
 * - See scaling preview (estimated dialogue lines, scenes, words)
 */
export function DurationSelector({
  duration,
  onDurationChange,
  contentStyle,
  onContentStyleChange,
  projectDefault,
  compact = false,
  disabled = false,
  className,
}: DurationSelectorProps) {
  const [showPreview, setShowPreview] = useState(!compact);

  // Find current preset or custom
  const currentPreset = DURATION_PRESETS.find((p) => p.value === duration);

  // Calculate scaling preview
  const preview = useMemo(
    () => getScalingPreview(duration, contentStyle),
    [duration, contentStyle],
  );

  // Get current style info
  const currentStyleInfo = CONTENT_STYLES.find((s) => s.value === contentStyle);

  if (compact) {
    return (
      <div className={cn('flex items-center gap-3', className)}>
        <div className="flex items-center gap-2">
          <Clock className="text-muted-foreground h-4 w-4" />
          <Select
            value={duration.toString()}
            onValueChange={(v) => onDurationChange(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DURATION_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value.toString()}>
                  {preset.label}
                  {projectDefault === preset.value && (
                    <span className="text-muted-foreground ml-1 text-xs">
                      (default)
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-2">
          {currentStyleInfo && (
            <currentStyleInfo.icon className="text-muted-foreground h-4 w-4" />
          )}
          <Select
            value={contentStyle}
            onValueChange={(v) => onContentStyleChange(v as ContentStyle)}
            disabled={disabled}
          >
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_STYLES.map((style) => (
                <SelectItem key={style.value} value={style.value}>
                  {style.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-muted-foreground text-xs">{preview}</span>
      </div>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {/* Duration Selection */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs font-normal">
          Target Duration
        </Label>
        <div className="flex flex-wrap gap-2">
          {DURATION_PRESETS.slice(0, 6).map((preset) => (
            <button
              key={preset.value}
              type="button"
              onClick={() => onDurationChange(preset.value)}
              disabled={disabled}
              className={cn(
                'border-input hover:bg-accent hover:text-accent-foreground rounded-md border px-3 py-1.5 text-sm transition-colors',
                duration === preset.value &&
                  'bg-primary text-primary-foreground border-primary',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {preset.label}
              {projectDefault === preset.value && (
                <Badge variant="outline" className="ml-1.5 text-xs">
                  Default
                </Badge>
              )}
            </button>
          ))}
          <Select
            value={
              DURATION_PRESETS.slice(6).some((p) => p.value === duration)
                ? duration.toString()
                : ''
            }
            onValueChange={(v) => onDurationChange(Number(v))}
            disabled={disabled}
          >
            <SelectTrigger
              className={cn(
                'h-auto w-[110px] py-1.5',
                DURATION_PRESETS.slice(6).some((p) => p.value === duration) &&
                  'bg-primary text-primary-foreground border-primary',
              )}
            >
              <SelectValue placeholder="More..." />
            </SelectTrigger>
            <SelectContent>
              {DURATION_PRESETS.slice(6).map((preset) => (
                <SelectItem key={preset.value} value={preset.value.toString()}>
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {currentPreset && (
          <p className="text-muted-foreground text-xs">
            {currentPreset.description}
          </p>
        )}
      </div>

      {/* Content Style Selection */}
      <div className="space-y-2">
        <Label className="text-muted-foreground text-xs font-normal">
          Content Style
        </Label>
        <div className="grid grid-cols-3 gap-2">
          {CONTENT_STYLES.map((style) => {
            const StyleIcon = style.icon;
            return (
              <button
                key={style.value}
                type="button"
                onClick={() => onContentStyleChange(style.value)}
                disabled={disabled}
                className={cn(
                  'border-input hover:bg-accent flex flex-col items-center gap-1.5 rounded-lg border p-3 transition-colors',
                  contentStyle === style.value &&
                    'bg-primary/10 border-primary ring-primary/20 ring-2',
                  disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <StyleIcon
                  className={cn(
                    'h-5 w-5',
                    contentStyle === style.value
                      ? 'text-primary'
                      : 'text-muted-foreground',
                  )}
                />
                <span className="text-xs font-medium">{style.label}</span>
              </button>
            );
          })}
        </div>
        {currentStyleInfo && (
          <p className="text-muted-foreground text-xs">
            {currentStyleInfo.description}
          </p>
        )}
      </div>

      {/* Scaling Preview */}
      {showPreview && (
        <div className="bg-muted/50 rounded-lg p-3">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs">
              Expected output:
            </span>
            <button
              type="button"
              onClick={() => setShowPreview(false)}
              className="text-muted-foreground hover:text-foreground text-xs"
            >
              Hide
            </button>
          </div>
          <p className="mt-1 text-sm font-medium">{preview}</p>
        </div>
      )}

      {!showPreview && (
        <button
          type="button"
          onClick={() => setShowPreview(true)}
          className="text-muted-foreground hover:text-foreground text-xs underline"
        >
          Show scaling preview
        </button>
      )}
    </div>
  );
}

/**
 * Inline duration badge for displaying current duration setting
 */
export function DurationBadge({
  duration,
  contentStyle,
  className,
}: {
  duration: number;
  contentStyle: ContentStyle;
  className?: string;
}) {
  const preset = DURATION_PRESETS.find((p) => p.value === duration);
  const styleInfo = CONTENT_STYLES.find((s) => s.value === contentStyle);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Badge variant="outline" className="gap-1">
        <Clock className="h-3 w-3" />
        {preset?.label ?? `${Math.round(duration / 60)} min`}
      </Badge>
      {styleInfo && (
        <Badge variant="outline" className="gap-1">
          <styleInfo.icon className="h-3 w-3" />
          {styleInfo.label}
        </Badge>
      )}
    </div>
  );
}
