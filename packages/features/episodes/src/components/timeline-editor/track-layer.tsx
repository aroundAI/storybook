'use client';

/**
 * Track Layer - Individual track rendering with clip containers
 */
import { timelineTrackTokens } from '@kit/film-studio/design-tokens';
import { cn } from '@kit/ui/utils';

import { ClipItem } from './clip-item';
import { useTimelineContext } from './timeline-context';
import type { ClipType, TimelineTrack } from './types';

// ============================================================================
// Types
// ============================================================================

interface TrackLayerProps {
  /** Track data */
  track: TimelineTrack;
  /** Additional CSS classes */
  className?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get background style for track based on type
 */
function getTrackBackgroundStyle(type: ClipType): string {
  const token = timelineTrackTokens[type];
  return `${token.bg}/10`;
}

// ============================================================================
// Component
// ============================================================================

export function TrackLayer({ track, className }: TrackLayerProps) {
  const { state } = useTimelineContext();

  return (
    <div
      className={cn(
        'relative border-b',
        track.isLocked && 'opacity-50',
        track.isMuted && 'bg-muted/30',
        className,
      )}
      style={{ height: track.height }}
      data-track-id={track.id}
      data-track-type={track.type}
    >
      {/* Track background with subtle type color */}
      <div
        className={cn('absolute inset-0', getTrackBackgroundStyle(track.type))}
      />

      {/* Clips */}
      {track.clips.map((clip) => (
        <ClipItem
          key={clip.id}
          clip={clip}
          trackHeight={track.height}
          isSelected={state.selectedClipIds.has(clip.id)}
          isLocked={track.isLocked || clip.isLocked}
        />
      ))}
    </div>
  );
}
