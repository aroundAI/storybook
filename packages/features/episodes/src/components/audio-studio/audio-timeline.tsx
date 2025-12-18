'use client';

import { useState } from 'react';

import { cn } from '@kit/ui/utils';

import { MaterialIcon } from '../ui';

export interface DialogueBlock {
  id: string;
  text: string;
  character: string;
  startTime: number; // in seconds
  duration: number; // in seconds
  color: 'orange' | 'purple' | 'green' | 'blue';
  status: 'completed' | 'pending' | 'generating';
}

export interface AudioTimelineProps {
  trackType: 'dialogue' | 'music' | 'sfx';
  dialogueBlocks?: DialogueBlock[];
  duration?: number; // Total duration in seconds
}

// Placeholder dialogue data matching the design
const DEFAULT_DIALOGUE: DialogueBlock[] = [
  {
    id: '1',
    text: 'Dante! Cece!',
    character: 'Origami Lion',
    startTime: 2,
    duration: 12,
    color: 'purple',
    status: 'pending',
  },
  {
    id: '2',
    text: 'My cub...',
    character: 'Origami Lion',
    startTime: 14.5,
    duration: 10.5,
    color: 'purple',
    status: 'pending',
  },
  {
    id: '3',
    text: "Don't worry... Mr. you find him!",
    character: 'Dante',
    startTime: 26.5,
    duration: 12.5,
    color: 'orange',
    status: 'pending',
  },
  {
    id: '4',
    text: 'We were counting by this clay mashroom. When',
    character: 'Origami Lion',
    startTime: 40.5,
    duration: 14.5,
    color: 'green',
    status: 'pending',
  },
];

const DEFAULT_DURATION = 90; // 1:30 in seconds

export function AudioTimeline({
  trackType,
  dialogueBlocks = DEFAULT_DIALOGUE,
  duration: _duration = DEFAULT_DURATION,
}: AudioTimelineProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>('3');

  // Generate time markers (every 15 seconds)
  const timeMarkers = Array.from({ length: 7 }, (_, i) => i * 15);

  const getColorClasses = (color: DialogueBlock['color']) => {
    const colorMap = {
      orange: {
        bg: 'bg-orange-100 dark:bg-orange-900/30',
        border: 'border-orange-200 dark:border-orange-700',
        text: 'text-orange-900 dark:text-orange-100',
        dot: 'bg-orange-500',
        label: 'text-orange-700 dark:text-orange-300',
      },
      purple: {
        bg: 'bg-purple-100 dark:bg-purple-900/30',
        border: 'border-purple-200 dark:border-purple-700',
        text: 'text-purple-900 dark:text-purple-100',
        dot: 'bg-purple-500',
        label: 'text-purple-700 dark:text-purple-300',
      },
      green: {
        bg: 'bg-green-100 dark:bg-green-900/30',
        border: 'border-green-200 dark:border-green-700',
        text: 'text-green-900 dark:text-green-100',
        dot: 'bg-green-500',
        label: 'text-green-700 dark:text-green-300',
      },
      blue: {
        bg: 'bg-blue-100 dark:bg-blue-900/30',
        border: 'border-blue-200 dark:border-blue-700',
        text: 'text-blue-900 dark:text-blue-100',
        dot: 'bg-blue-500',
        label: 'text-blue-700 dark:text-blue-300',
      },
    };

    return colorMap[color];
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleBlockClick = (blockId: string) => {
    setSelectedBlockId(blockId);
  };

  return (
    <div className="border-border bg-surface flex h-full flex-col overflow-hidden rounded-2xl border shadow-sm">
      {/* Time Ruler */}
      <div className="border-border bg-muted/50 text-muted-foreground flex h-10 items-end border-b px-4 font-mono text-[10px]">
        <div className="relative flex flex-1 justify-between px-2 pb-1">
          {timeMarkers.map((seconds) => (
            <span key={seconds}>{formatTime(seconds)}</span>
          ))}

          {/* Tick marks */}
          <div className="absolute bottom-0 left-0 flex h-1.5 w-full justify-between px-2">
            {timeMarkers.map((seconds) => (
              <span key={seconds} className="bg-border h-full w-px"></span>
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="bg-grid relative flex-1 overflow-x-auto overflow-y-auto p-4">
        {/* Playhead indicator */}
        <div className="bg-foreground absolute bottom-0 left-[20px] top-0 z-10 flex w-0.5 flex-col items-center">
          <div className="bg-foreground -mt-1.5 h-3 w-3 rotate-45 rounded-sm"></div>
        </div>

        {/* Dialogue Blocks */}
        <div className="relative min-w-[800px] space-y-4 pt-2">
          {trackType === 'dialogue' &&
            dialogueBlocks.map((block) => {
              const colors = getColorClasses(block.color);
              const isSelected = selectedBlockId === block.id;
              // Calculate position based on time (assuming 1 second = ~10px for demo)
              const leftPosition = block.startTime * 10 + 30;
              const width = block.duration * 10;

              return (
                <div key={block.id} className="relative h-24">
                  <div
                    onClick={() => handleBlockClick(block.id)}
                    className={cn(
                      'absolute top-0 cursor-pointer rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md',
                      colors.bg,
                      colors.border,
                      isSelected &&
                        'ring-primary z-20 shadow-md ring-2 ring-offset-2 dark:ring-offset-black',
                    )}
                    style={{
                      left: `${leftPosition}px`,
                      width: `${width}px`,
                    }}
                  >
                    <p className={cn('mb-2 text-sm font-medium', colors.text)}>
                      {block.text}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <div
                        className={cn('h-2 w-2 rounded-full', colors.dot)}
                      ></div>
                      <span
                        className={cn(
                          'text-[10px] font-semibold uppercase tracking-wide',
                          colors.label,
                        )}
                      >
                        {block.character}
                      </span>
                    </div>

                    {/* Hand icon for selected block (matching design) */}
                    {isSelected && (
                      <span
                        className="text-foreground absolute -right-3 bottom-2 rotate-[-15deg] text-xl drop-shadow-md"
                        style={{ transform: 'rotate(-15deg)' }}
                      >
                        <MaterialIcon name="pan_tool_alt" />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

          {/* Music/SFX placeholder */}
          {trackType === 'music' && (
            <div className="border-border mt-8 border-t pt-2">
              <h5 className="text-muted-foreground mb-2 pl-4 text-[10px] font-semibold uppercase tracking-wide">
                Music/SFX
              </h5>
              <div className="relative h-8 w-full">
                <div
                  className="absolute h-6 rounded-md border border-green-200 bg-green-200/50 dark:border-green-800 dark:bg-green-900/20"
                  style={{ left: '400px', width: '430px' }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {/* Context Menu (only for selected block) */}
        {selectedBlockId === '3' && (
          <div className="border-border bg-background absolute right-[160px] top-1/2 z-50 w-40 -translate-y-1/2 transform rounded-xl border py-1.5 shadow-xl">
            <button className="text-foreground hover:bg-muted flex w-full items-center gap-2 px-4 py-2 text-xs font-medium">
              <MaterialIcon name="play_arrow" className="text-sm" />
              Play
            </button>
            <button className="text-foreground hover:bg-muted flex w-full items-center gap-2 px-4 py-2 text-xs font-medium">
              <MaterialIcon name="autorenew" className="text-sm" />
              Regenerate
            </button>
            <button className="text-foreground hover:bg-muted flex w-full items-center gap-2 px-4 py-2 text-xs font-medium">
              <MaterialIcon name="mic" className="text-sm" />
              Assign Voice
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
