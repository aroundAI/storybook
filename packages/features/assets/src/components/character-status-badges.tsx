'use client';

import { Image as ImageIcon, Mic, Sparkles } from 'lucide-react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

interface CharacterStatusBadgesProps {
  hasVoice: boolean;
  hasImage: boolean;
  hasElementPrompt?: boolean;
  className?: string;
}

const BADGE_STYLES = {
  present:
    'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-500/20 dark:bg-emerald-900/30 dark:text-emerald-300',
  missing: 'bg-muted text-muted-foreground ring-1 ring-border',
} as const;

function StatusBadge({
  icon: Icon,
  label,
  present,
  tooltipText,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  present: boolean;
  tooltipText: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            present ? BADGE_STYLES.present : BADGE_STYLES.missing,
          )}
        >
          <Icon className="h-3 w-3 shrink-0" />
          <span>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

export function CharacterStatusBadges({
  hasVoice,
  hasImage,
  hasElementPrompt,
  className,
}: CharacterStatusBadgesProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
        <StatusBadge
          icon={Mic}
          label="Voice"
          present={hasVoice}
          tooltipText={
            hasVoice ? 'ElevenLabs voice assigned' : 'No voice profile assigned'
          }
        />
        <StatusBadge
          icon={ImageIcon}
          label="Image"
          present={hasImage}
          tooltipText={
            hasImage ? 'Character image uploaded' : 'No character image'
          }
        />
        {hasElementPrompt !== undefined && (
          <StatusBadge
            icon={Sparkles}
            label="VEO"
            present={hasElementPrompt}
            tooltipText={
              hasElementPrompt ? 'VEO prompt ready' : 'No VEO prompt generated'
            }
          />
        )}
      </div>
    </TooltipProvider>
  );
}
