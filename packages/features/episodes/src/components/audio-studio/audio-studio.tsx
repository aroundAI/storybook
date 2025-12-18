'use client';

import { useState } from 'react';

import { Button } from '@kit/ui/button';

import { MaterialIcon } from '../ui';
import { AudioTimeline } from './audio-timeline';
import { VoiceAssignmentPanel } from './voice-assignment-panel';

export interface AudioStudioProps {
  episodeId: string;
  episodeTitle: string;
}

type TrackType = 'dialogue' | 'music' | 'sfx';

export function AudioStudio({
  episodeId: _episodeId,
  episodeTitle: _episodeTitle,
}: AudioStudioProps) {
  const [activeTrackType, setActiveTrackType] = useState<TrackType>('dialogue');

  // Placeholder data
  const completedCount = 0;
  const pendingCount = 16;

  return (
    <div className="space-y-6">
      {/* Sub-header Toolbar */}
      <div className="border-border bg-surface sticky top-0 z-10 rounded-2xl border p-2 shadow-sm">
        <div className="flex flex-col items-center justify-between gap-4 lg:flex-row">
          {/* Left: Track Type Tabs + Status */}
          <div className="flex w-full items-center gap-4 overflow-x-auto px-2 lg:w-auto">
            {/* Track Type Toggle */}
            <div className="bg-muted flex rounded-lg p-1">
              <button
                onClick={() => setActiveTrackType('dialogue')}
                className={`rounded-md px-4 py-1.5 text-xs font-semibold transition-all ${
                  activeTrackType === 'dialogue'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Dialogue{' '}
                <span className="text-muted-foreground ml-1 font-normal">
                  {pendingCount}
                </span>
              </button>
              <button
                onClick={() => setActiveTrackType('music')}
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                  activeTrackType === 'music'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Music
              </button>
              <button
                onClick={() => setActiveTrackType('sfx')}
                className={`rounded-md px-4 py-1.5 text-xs font-medium transition-all ${
                  activeTrackType === 'sfx'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                SFX
              </button>
            </div>

            <div className="bg-border h-6 w-px"></div>

            {/* Status Badges */}
            <div className="flex items-center gap-2">
              <span className="rounded-md border border-green-100 bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-400">
                {completedCount} completed
              </span>
              <span className="rounded-md border border-orange-100 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 dark:border-orange-800 dark:bg-orange-900/20 dark:text-orange-400">
                {pendingCount} pending
              </span>
            </div>
          </div>

          {/* Right: Actions */}
          <div className="flex w-full items-center justify-end gap-2 px-2 lg:w-auto">
            <Button
              variant="outline"
              size="sm"
              className="gap-2 text-xs font-medium"
            >
              <MaterialIcon name="settings" className="text-sm" />
              Settings
            </Button>
            <Button
              size="sm"
              variant="default"
              className="gap-2 text-xs font-semibold shadow-sm"
            >
              <MaterialIcon name="play_circle" className="text-sm" />
              Generate All Pending
            </Button>
            <Button
              size="sm"
              className="bg-primary hover:bg-primary/90 gap-2 text-xs font-semibold shadow-sm"
            >
              <MaterialIcon name="file_upload" className="text-sm" />
              Export
            </Button>
          </div>
        </div>
      </div>

      {/* Main Content: Voice Assignment + Timeline */}
      <div className="grid h-[600px] grid-cols-1 gap-6 overflow-hidden lg:grid-cols-4">
        {/* Voice Assignment Panel (1/4 width) */}
        <div className="lg:col-span-1">
          <VoiceAssignmentPanel />
        </div>

        {/* Audio Timeline (3/4 width) */}
        <div className="lg:col-span-3">
          <AudioTimeline trackType={activeTrackType} />
        </div>
      </div>
    </div>
  );
}
