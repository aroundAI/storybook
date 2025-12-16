'use client';

import { Info } from 'lucide-react';

import { ToggleGroup, ToggleGroupItem } from '@kit/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import type { CaptionStylePreset } from '../../lib/schemas/caption.schema';

interface StyleOption {
  value: CaptionStylePreset;
  label: string;
  description: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'standard',
    label: 'Standard',
    description:
      'Clean, readable captions with white text on semi-transparent background',
  },
  {
    value: 'bold',
    label: 'Bold',
    description: 'High-contrast captions with thick font and dark background',
  },
  {
    value: 'minimal',
    label: 'Minimal',
    description: 'Subtle captions with no background, just text shadow',
  },
  {
    value: 'animated',
    label: 'Animated',
    description: 'Word-by-word highlighting synced to audio timing',
  },
];

interface CaptionStyleSelectorProps {
  currentStyle: CaptionStylePreset;
  onStyleChange: (style: CaptionStylePreset) => void;
  disabled?: boolean;
}

export function CaptionStyleSelector({
  currentStyle,
  onStyleChange,
  disabled,
}: CaptionStyleSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">Style</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info className="text-muted-foreground h-3.5 w-3.5" />
            </TooltipTrigger>
            <TooltipContent>
              <p>Choose how captions appear in the video</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <ToggleGroup
        type="single"
        value={currentStyle}
        onValueChange={(value) => {
          if (value) {
            onStyleChange(value as CaptionStylePreset);
          }
        }}
        disabled={disabled}
        className="justify-start"
      >
        {STYLE_OPTIONS.map((option) => (
          <TooltipProvider key={option.value}>
            <Tooltip>
              <TooltipTrigger asChild>
                <ToggleGroupItem
                  value={option.value}
                  aria-label={option.label}
                  className="px-3"
                >
                  {option.label}
                </ToggleGroupItem>
              </TooltipTrigger>
              <TooltipContent>
                <p className="max-w-xs">{option.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ))}
      </ToggleGroup>
    </div>
  );
}
