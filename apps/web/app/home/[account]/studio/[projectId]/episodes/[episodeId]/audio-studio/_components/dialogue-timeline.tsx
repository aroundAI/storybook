'use client';

import { useMemo, useState } from 'react';

import { Mic, Play, RefreshCw, Volume2 } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { generateDialogueVoiceAction } from '@kit/audio-generation/server';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

interface DialogueTimelineProps {
  dialogueLines: DialogueLine[];
  characters: CharacterAsset[];
  isLoading: boolean;
  onRefresh: () => void;
}

interface TimelineDialogue extends DialogueLine {
  startTime: number;
  duration: number;
  characterName: string;
}

// Character color palette
const CHARACTER_COLORS = [
  {
    name: 'orange',
    bg: 'bg-orange-100 dark:bg-orange-900/30',
    border: 'border-orange-200 dark:border-orange-700',
    text: 'text-orange-900 dark:text-orange-100',
    dot: 'bg-orange-500',
  },
  {
    name: 'purple',
    bg: 'bg-purple-100 dark:bg-purple-900/30',
    border: 'border-purple-200 dark:border-purple-700',
    text: 'text-purple-900 dark:text-purple-100',
    dot: 'bg-purple-500',
  },
  {
    name: 'green',
    bg: 'bg-green-100 dark:bg-green-900/30',
    border: 'border-green-200 dark:border-green-700',
    text: 'text-green-900 dark:text-green-100',
    dot: 'bg-green-500',
  },
  {
    name: 'blue',
    bg: 'bg-blue-100 dark:bg-blue-900/30',
    border: 'border-blue-200 dark:border-blue-700',
    text: 'text-blue-900 dark:text-blue-100',
    dot: 'bg-blue-500',
  },
  {
    name: 'pink',
    bg: 'bg-pink-100 dark:bg-pink-900/30',
    border: 'border-pink-200 dark:border-pink-700',
    text: 'text-pink-900 dark:text-pink-100',
    dot: 'bg-pink-500',
  },
  {
    name: 'cyan',
    bg: 'bg-cyan-100 dark:bg-cyan-900/30',
    border: 'border-cyan-200 dark:border-cyan-700',
    text: 'text-cyan-900 dark:text-cyan-100',
    dot: 'bg-cyan-500',
  },
];

const WORDS_PER_MINUTE = 150;
const SECONDS_PER_WORD = 60 / WORDS_PER_MINUTE;
const GAP_BETWEEN_DIALOGUES = 0.5;
const TIMELINE_LEFT_PADDING = 30; // pixels for playhead

function estimateDuration(text: string | null | undefined): number {
  if (!text || typeof text !== 'string') return 1;
  const wordCount = text.split(/\s+/).length;
  return Math.max(1, wordCount * SECONDS_PER_WORD);
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function DialogueTimeline({
  dialogueLines,
  characters,
  isLoading,
  onRefresh,
}: DialogueTimelineProps) {
  const [selectedDialogue, setSelectedDialogue] =
    useState<TimelineDialogue | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isGenerating, setIsGenerating] = useState(false);

  // Map character IDs to colors
  const characterColorMap = useMemo(() => {
    const map: Record<string, (typeof CHARACTER_COLORS)[0]> = {};
    characters.forEach((char, i) => {
      map[char.id] = CHARACTER_COLORS[i % CHARACTER_COLORS.length]!;
    });
    return map;
  }, [characters]);

  // Map character IDs to names
  const characterNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    characters.forEach((char) => {
      map[char.id] = char.name;
    });
    return map;
  }, [characters]);

  // Build timeline with positions
  const { positionedDialogues, totalDuration, timeMarkers } = useMemo(() => {
    // Defensive: ensure dialogueLines is an array
    const lines = Array.isArray(dialogueLines) ? dialogueLines : [];

    // Calculate positions for each dialogue line
    // Priority: DB timeline position > fallback to sequential calculation
    const positioned: TimelineDialogue[] = lines.map((d) => {
      // Use DB timeline position if available, otherwise calculate fallback
      const startTime =
        typeof d.timelineStartSeconds === 'number'
          ? d.timelineStartSeconds
          : null;

      // Duration priority: generated audio > DB estimated > calculated from text
      const metadataDuration =
        typeof d.generationMetadata?.durationSeconds === 'number'
          ? d.generationMetadata.durationSeconds
          : null;
      const dbEstimatedDuration =
        typeof d.estimatedDurationSeconds === 'number'
          ? d.estimatedDurationSeconds
          : null;
      const duration =
        metadataDuration ?? dbEstimatedDuration ?? estimateDuration(d.text);

      return {
        ...d,
        startTime: startTime ?? 0, // Will be recalculated below if null
        duration,
        characterName: characterNameMap[d.characterAssetId ?? ''] ?? 'Unknown',
      };
    });

    // Check if any dialogue has DB timeline position
    const hasDbTimeline = positioned.some(
      (d) => typeof d.timelineStartSeconds === 'number',
    );

    // If no DB timeline, calculate positions sequentially as fallback
    if (!hasDbTimeline) {
      // Sort by sequence number for fallback calculation
      positioned.sort(
        (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
      );
      let currentTime = 0;
      for (const d of positioned) {
        d.startTime = currentTime;
        currentTime += d.duration + GAP_BETWEEN_DIALOGUES;
      }
    } else {
      // Sort by timeline position when using DB values
      positioned.sort((a, b) => a.startTime - b.startTime);
    }

    // Calculate total duration
    const lastDialogue = positioned[positioned.length - 1];
    const calculatedTotal = lastDialogue
      ? lastDialogue.startTime + lastDialogue.duration + GAP_BETWEEN_DIALOGUES
      : 0;
    const total = calculatedTotal > 0 ? calculatedTotal : 90; // Default to 90 seconds if empty

    // Generate time markers every 15 seconds
    const markers: number[] = [];
    for (let t = 0; t <= total; t += 15) {
      markers.push(t);
    }

    return {
      positionedDialogues: positioned,
      totalDuration: total,
      timeMarkers: markers,
    };
  }, [dialogueLines, characterNameMap]);

  const handleDialogueClick = (
    dialogue: TimelineDialogue,
    event: React.MouseEvent,
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.top,
    });
    setSelectedDialogue(dialogue);
  };

  const handlePlay = () => {
    if (!selectedDialogue?.audioUrl) {
      toast.error('No audio available');
      return;
    }
    const audio = new Audio(selectedDialogue.audioUrl);
    audio.play();
    setSelectedDialogue(null);
  };

  const handleRegenerate = async () => {
    if (!selectedDialogue) return;

    setIsGenerating(true);
    try {
      const result = await generateDialogueVoiceAction({
        dialogueLineId: selectedDialogue.id,
        overwriteExisting: true,
      });

      if (result.status === 'completed') {
        toast.success('Voice regenerated successfully');
        onRefresh();
      } else {
        toast.error(result.error ?? 'Failed to regenerate voice');
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to regenerate',
      );
    } finally {
      setIsGenerating(false);
      setSelectedDialogue(null);
    }
  };

  const handleAssignVoice = () => {
    toast.info('Voice assignment coming soon');
    setSelectedDialogue(null);
  };

  const getCharacterColor = (characterAssetId: string | null) => {
    return (
      characterColorMap[characterAssetId ?? ''] ?? {
        bg: 'bg-gray-100 dark:bg-gray-800',
        border: 'border-gray-200 dark:border-gray-700',
        text: 'text-gray-900 dark:text-gray-100',
        dot: 'bg-gray-500',
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-full flex-col bg-gray-50 dark:bg-gray-900">
        <div className="h-10 border-b bg-gray-100 dark:bg-black/20" />
        <div className="flex-1 space-y-4 p-4">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (dialogueLines.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
        <div className="text-center">
          <Volume2 className="mx-auto mb-3 h-12 w-12 opacity-30" />
          <p>No dialogue lines found</p>
          <p className="mt-1 text-sm">
            Generate a screenplay first to see dialogue
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full flex-col bg-white dark:bg-gray-900">
      {/* Time Ruler */}
      <div className="flex h-10 items-end border-b border-gray-200/50 bg-gray-50 px-4 font-mono text-[10px] text-gray-400 select-none dark:border-gray-700/50 dark:bg-black/20">
        <div
          className="relative flex flex-1 justify-between pb-1"
          style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
        >
          {timeMarkers.map((time) => (
            <span key={time}>{formatTime(time)}</span>
          ))}
          <div className="absolute bottom-0 left-0 flex h-1.5 w-full justify-between px-2">
            {timeMarkers.map((time) => (
              <span
                key={time}
                className="h-full w-px bg-gray-300 dark:bg-gray-700"
              />
            ))}
          </div>
        </div>
      </div>

      {/* Timeline Content */}
      <div className="flex-1 overflow-x-auto overflow-y-auto p-4">
        {/* Playhead */}
        <div className="pointer-events-none absolute top-10 bottom-0 left-[20px] z-10 flex w-0.5 flex-col items-center bg-black dark:bg-white">
          <div className="-mt-1.5 h-3 w-3 rotate-45 rounded-sm bg-black dark:bg-white" />
        </div>

        {/* Dialogue Blocks Container */}
        <div
          className="relative min-w-[800px] space-y-4 pt-2"
          style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
        >
          {positionedDialogues.map((dialogue) => {
            const colors = getCharacterColor(dialogue.characterAssetId);
            const leftPercent = (dialogue.startTime / totalDuration) * 100;
            const widthPercent = Math.max(
              (dialogue.duration / totalDuration) * 100,
              10,
            );

            return (
              <div key={dialogue.id} className="relative h-24">
                <div
                  className={cn(
                    'absolute cursor-pointer rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md',
                    colors.bg,
                    colors.border,
                    selectedDialogue?.id === dialogue.id &&
                      'ring-2 ring-blue-500 ring-offset-2 dark:ring-offset-gray-900',
                  )}
                  style={{
                    left: `${leftPercent}%`,
                    width: `${widthPercent}%`,
                    minWidth: '160px',
                  }}
                  onClick={(e) => handleDialogueClick(dialogue, e)}
                >
                  <p
                    className={cn(
                      'mb-2 line-clamp-2 text-sm font-medium',
                      colors.text,
                    )}
                  >
                    {dialogue.text ?? 'No text'}
                  </p>
                  <div className="flex items-center gap-1.5">
                    <div className={cn('h-2 w-2 rounded-full', colors.dot)} />
                    <span
                      className={cn(
                        'text-[10px] font-semibold tracking-wide uppercase',
                        colors.text,
                      )}
                    >
                      {dialogue.characterName}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Music/SFX Section */}
        <div className="mt-8 border-t border-gray-200/50 pt-2 dark:border-gray-700/50">
          <h5 className="mb-2 pl-4 text-[10px] font-semibold tracking-wide text-gray-400 uppercase">
            Music/SFX
          </h5>
          <div className="relative h-8 w-full">
            {/* Placeholder for future music/sfx tracks */}
            <div className="ml-8 h-6 w-[60%] rounded-md border border-green-200 bg-green-200/50 dark:border-green-800 dark:bg-green-900/20" />
          </div>
        </div>
      </div>

      {/* Context Menu */}
      {selectedDialogue && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setSelectedDialogue(null)}
          />
          {/* Menu */}
          <div
            className="fixed z-50 w-40 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{ top: menuPosition.y, left: menuPosition.x }}
          >
            <button
              onClick={handlePlay}
              disabled={!selectedDialogue.audioUrl}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <Play className="h-4 w-4" /> Play
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isGenerating}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <RefreshCw
                className={cn('h-4 w-4', isGenerating && 'animate-spin')}
              />
              {isGenerating ? 'Generating...' : 'Regenerate'}
            </button>
            <button
              onClick={handleAssignVoice}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <Mic className="h-4 w-4" /> Assign Voice
            </button>
          </div>
        </>
      )}
    </div>
  );
}
