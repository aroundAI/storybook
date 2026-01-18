'use client';

import { useMemo, useState } from 'react';

import { Edit3, Play, RefreshCw, Volume2 } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { ProjectAudioSettings } from '@kit/audio-generation/lib';
import {
  generateDialogueVoiceAction,
  updateDialogueTextAction,
} from '@kit/audio-generation/server';
import { Button } from '@kit/ui/button';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

interface DialogueTimelineProps {
  dialogueLines: DialogueLine[];
  characters: CharacterAsset[];
  isLoading: boolean;
  onRefresh: () => void;
  pixelsPerSecond: number;
  audioSettings?: ProjectAudioSettings | null;
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

// Helper to get marker interval based on zoom level
function getMarkerInterval(pps: number): number {
  if (pps >= 120) return 1; // Every 1 second when zoomed in
  if (pps >= 60) return 5; // Every 5 seconds
  return 15; // Every 15 seconds when zoomed out
}

export function DialogueTimeline({
  dialogueLines,
  characters,
  isLoading,
  onRefresh,
  pixelsPerSecond,
  audioSettings,
}: DialogueTimelineProps) {
  const [selectedDialogue, setSelectedDialogue] =
    useState<TimelineDialogue | null>(null);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);

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

    // Generate time markers based on zoom level
    const markerInterval = getMarkerInterval(pixelsPerSecond);
    const markers: number[] = [];
    for (let t = 0; t <= total; t += markerInterval) {
      markers.push(t);
    }

    return {
      positionedDialogues: positioned,
      totalDuration: total,
      timeMarkers: markers,
    };
  }, [dialogueLines, characterNameMap, pixelsPerSecond]);

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

    if (!audioSettings?.elevenlabs?.tts_model) {
      toast.error('Voice model not selected in project settings');
      return;
    }

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

  const handleEdit = () => {
    if (!selectedDialogue) return;
    setEditText(selectedDialogue.text ?? '');
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedDialogue || !editText.trim()) return;

    setIsSaving(true);
    try {
      await updateDialogueTextAction({
        dialogueLineId: selectedDialogue.id,
        text: editText.trim(),
      });
      toast.success('Dialogue updated');
      setIsEditModalOpen(false);
      setSelectedDialogue(null);
      onRefresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update dialogue',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const getCharacterColor = (characterAssetId: string | null) => {
    return (
      characterColorMap[characterAssetId ?? ''] ?? {
        bg: 'bg-muted',
        border: 'border-border',
        text: 'text-gray-900 dark:text-gray-100',
        dot: 'bg-gray-500',
      }
    );
  };

  if (isLoading) {
    return (
      <div className="bg-background flex h-full flex-col">
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

  // Calculate timeline width for consistent use
  const timelineWidth = Math.max(
    totalDuration * pixelsPerSecond + TIMELINE_LEFT_PADDING + 40,
    800,
  );

  return (
    <div className="bg-card relative flex h-full flex-col">
      {/* Playhead - fixed position */}
      <div className="pointer-events-none absolute top-0 bottom-0 left-[20px] z-20 flex w-0.5 flex-col items-center bg-black dark:bg-white">
        <div className="-mt-1.5 h-3 w-3 rotate-45 rounded-sm bg-black dark:bg-white" />
      </div>

      {/* Single scroll container for ruler and content */}
      <div className="flex-1 overflow-x-auto overflow-y-auto">
        {/* Time Ruler - sticky at top */}
        <div
          className="sticky top-0 z-10 flex h-10 items-end border-b border-gray-200/50 bg-gray-50 px-4 font-mono text-[10px] text-gray-400 select-none dark:border-gray-700/50 dark:bg-black/20"
          style={{ width: `${timelineWidth}px`, minWidth: '100%' }}
        >
          <div
            className="relative h-full w-full pb-1"
            style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
          >
            {timeMarkers.map((time) => (
              <span
                key={time}
                className="absolute bottom-2 -translate-x-1/2"
                style={{
                  left: `${TIMELINE_LEFT_PADDING + time * pixelsPerSecond}px`,
                }}
              >
                {formatTime(time)}
              </span>
            ))}
            <div className="absolute bottom-0 left-0 h-1.5 w-full">
              {timeMarkers.map((time) => (
                <span
                  key={time}
                  className="absolute h-full w-px bg-gray-300 dark:bg-gray-700"
                  style={{
                    left: `${TIMELINE_LEFT_PADDING + time * pixelsPerSecond}px`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Timeline Content */}
        <div className="p-4" style={{ width: `${timelineWidth}px` }}>
          {/* Dialogue Blocks Container */}
          <div
            className="relative space-y-4 pt-2"
            style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
          >
            {positionedDialogues.map((dialogue) => {
              const colors = getCharacterColor(dialogue.characterAssetId);
              // Pixel-based positioning
              const leftPx = dialogue.startTime * pixelsPerSecond;
              const widthPx = Math.max(
                dialogue.duration * pixelsPerSecond,
                160,
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
                      left: `${leftPx}px`,
                      width: `${widthPx}px`,
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
              onClick={handleEdit}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <Edit3 className="h-4 w-4" /> Edit
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
          </div>
        </>
      )}

      {/* Edit Modal */}
      {isEditModalOpen && selectedDialogue && (
        <>
          {/* Modal Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-black/50"
            onClick={() => setIsEditModalOpen(false)}
          />
          {/* Modal Content */}
          <div className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800">
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
              Edit Dialogue
            </h3>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {selectedDialogue.characterName}
            </p>
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="mb-4 h-32 w-full resize-none rounded-lg border border-gray-300 p-3 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-blue-400"
              placeholder="Enter dialogue text..."
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsEditModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleSaveEdit}
                disabled={isSaving || !editText.trim()}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
