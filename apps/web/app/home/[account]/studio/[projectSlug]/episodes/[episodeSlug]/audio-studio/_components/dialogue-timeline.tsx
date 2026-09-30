'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Edit3, Keyboard, Play, RefreshCw, Volume2 } from 'lucide-react';

import type { CharacterAsset, DialogueLine } from '@kit/audio-generation/lib';
import { ProjectAudioSettings } from '@kit/audio-generation/lib';
import {
  generateDialogueVoiceAsyncAction,
  updateDialogueTextAction,
} from '@kit/audio-generation/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { Button } from '@kit/ui/button';
import { useLlmJob } from '@kit/ui/hooks';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import {
  DIALOGUE_SHORTCUTS,
  isKeyboardIgnoredTarget,
  moveDialogueIndex,
  resolveDialogueShortcut,
} from './dialogue-keyboard';

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
  const [generatingIds, setGeneratingIds] = useState<Set<string>>(new Set());
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [activeDialogueId, setActiveDialogueId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playingIdRef = useRef<string | null>(null);
  const blocksRef = useRef<HTMLDivElement | null>(null);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // WebSocket hook for dialogue-voice-generation results
  const {
    status: voiceGenStatus,
    result: voiceGenResult,
    error: voiceGenError,
  } = useLlmJob<{
    success: boolean;
    dialogueLineId?: string;
    audioUrl?: string;
  }>('dialogue-voice-generation');

  // Handle WebSocket voice generation result
  useEffect(() => {
    if (voiceGenStatus === 'success' && voiceGenResult?.success) {
      toast.success('Voice generated successfully');
      onRefresh();
      // Clear generating state for the completed dialogue
      if (voiceGenResult.dialogueLineId) {
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(voiceGenResult.dialogueLineId!);
          return next;
        });
      }
    } else if (voiceGenStatus === 'error') {
      toast.error(voiceGenError || 'Voice generation failed');
      onRefresh();
    }
  }, [voiceGenStatus, voiceGenResult, voiceGenError, onRefresh]);

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

  const openMenuFor = (dialogue: TimelineDialogue, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setMenuPosition({
      x: rect.right + 8,
      y: rect.top,
    });
    setSelectedDialogue(dialogue);
  };

  const handleDialogueClick = (
    dialogue: TimelineDialogue,
    event: React.MouseEvent,
  ) => {
    openMenuFor(dialogue, event.currentTarget as HTMLElement);
  };

  const getBlockElements = () =>
    Array.from(
      blocksRef.current?.querySelectorAll<HTMLElement>(
        '[data-dialogue-block]',
      ) ?? [],
    );

  const focusBlock = (dialogueId: string) => {
    getBlockElements()
      .find((element) => element.dataset.dialogueId === dialogueId)
      ?.focus();
  };

  const focusFirstMenuItem = useCallback((menu: HTMLDivElement | null) => {
    menu
      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
      ?.focus();
  }, []);

  const closeMenu = () => {
    const returnToId = selectedDialogue?.id;
    setSelectedDialogue(null);
    if (returnToId) {
      focusBlock(returnToId);
    }
  };

  const togglePlayback = (dialogue: TimelineDialogue) => {
    if (!dialogue.audioUrl) {
      toast.error('No audio available');
      return;
    }
    const current = audioRef.current;
    if (current && playingIdRef.current === dialogue.id) {
      if (current.paused) {
        current.play().catch(() => {});
      } else {
        current.pause();
      }
      return;
    }
    current?.pause();
    const audio = new Audio(dialogue.audioUrl);
    audio.onended = () => {
      audioRef.current = null;
      playingIdRef.current = null;
    };
    audioRef.current = audio;
    playingIdRef.current = dialogue.id;
    audio.play().catch(() => {});
  };

  const handleBlocksKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isKeyboardIgnoredTarget(event.target)) {
      return;
    }
    const shortcut = resolveDialogueShortcut(event.nativeEvent);
    const target = event.target as HTMLElement;
    const dialogueId = target.dataset.dialogueId;
    const dialogue = positionedDialogues.find((d) => d.id === dialogueId);
    if (!shortcut || !dialogue) {
      return;
    }
    event.preventDefault();

    switch (shortcut) {
      case 'toggle-play':
        togglePlayback(dialogue);
        return;
      case 'open-menu':
        openMenuFor(dialogue, target);
        return;
      case 'edit':
        setSelectedDialogue(dialogue);
        setEditText(dialogue.text ?? '');
        setIsEditModalOpen(true);
        return;
      case 'close':
        return;
      default: {
        const index = positionedDialogues.findIndex(
          (d) => d.id === dialogue.id,
        );
        const next =
          positionedDialogues[
            moveDialogueIndex(index, shortcut, positionedDialogues.length)
          ];
        if (next) {
          focusBlock(next.id);
        }
      }
    }
  };

  const handlePlay = () => {
    if (!selectedDialogue?.audioUrl) {
      toast.error('No audio available');
      return;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    audioRef.current = new Audio(selectedDialogue.audioUrl);
    audioRef.current.onended = () => {
      audioRef.current = null;
    };
    audioRef.current.play().catch(() => {});
    setSelectedDialogue(null);
  };

  const handleRegenerate = async () => {
    if (!selectedDialogue) return;

    if (!audioSettings?.elevenlabs?.tts_model) {
      toast.error('Voice model not selected in project settings');
      return;
    }

    const dialogueId = selectedDialogue.id;
    setGeneratingIds((prev) => new Set(prev).add(dialogueId));
    setSelectedDialogue(null);

    try {
      const result = await unwrap(
        generateDialogueVoiceAsyncAction({
          dialogueLineId: dialogueId,
          overwriteExisting: true,
        }),
      );

      if (result.status === 'queued') {
        toast.success('Voice generation started');
      } else {
        toast.error(result.error ?? 'Failed to start voice generation');
        setGeneratingIds((prev) => {
          const next = new Set(prev);
          next.delete(dialogueId);
          return next;
        });
      }
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to regenerate'));
      setGeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(dialogueId);
        return next;
      });
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
      await unwrap(
        updateDialogueTextAction({
          dialogueLineId: selectedDialogue.id,
          text: editText.trim(),
        }),
      );
      toast.success('Dialogue updated');
      setIsEditModalOpen(false);
      setSelectedDialogue(null);
      onRefresh();
    } catch (error) {
      toast.error(refusalMessage(error, 'Failed to update dialogue'));
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
      <div className="flex h-full flex-col bg-background">
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
    <div className="relative flex h-full flex-col bg-card">
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
          <details
            className="sticky left-4 mb-2 w-fit text-xs text-gray-500 dark:text-gray-400"
            data-test="dialogue-shortcuts"
          >
            <summary className="flex cursor-pointer items-center gap-1.5 rounded focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none">
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
              Keyboard shortcuts
            </summary>
            <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              {DIALOGUE_SHORTCUTS.map((shortcut) => (
                <div key={shortcut.keys} className="contents">
                  <dt className="font-mono">{shortcut.keys}</dt>
                  <dd>{shortcut.description}</dd>
                </div>
              ))}
            </dl>
          </details>
          {/* Dialogue Blocks Container */}
          <div
            ref={blocksRef}
            role="group"
            aria-label="Dialogue lines. Arrow keys move between lines, Space plays, Enter opens actions, E edits."
            data-test="dialogue-blocks"
            className="relative space-y-4 pt-2"
            style={{ paddingLeft: TIMELINE_LEFT_PADDING }}
            onKeyDown={handleBlocksKeyDown}
          >
            {positionedDialogues.map((dialogue, index) => {
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
                    role="button"
                    tabIndex={
                      (activeDialogueId ?? positionedDialogues[0]?.id) ===
                      dialogue.id
                        ? 0
                        : -1
                    }
                    aria-label={`${dialogue.characterName}: ${(dialogue.text ?? 'No text').slice(0, 80)}`}
                    aria-pressed={selectedDialogue?.id === dialogue.id}
                    aria-haspopup="menu"
                    data-dialogue-block
                    data-dialogue-id={dialogue.id}
                    data-test={`dialogue-block-${index}`}
                    onFocus={() => setActiveDialogueId(dialogue.id)}
                    className={cn(
                      'absolute cursor-pointer rounded-xl border p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:outline-none dark:focus-visible:ring-offset-gray-900',
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
      {selectedDialogue && !isEditModalOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            aria-hidden="true"
            onClick={() => setSelectedDialogue(null)}
          />
          {/* Menu */}
          <div
            ref={focusFirstMenuItem}
            role="menu"
            aria-label="Dialogue line actions"
            data-test="dialogue-menu"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                closeMenu();
              }
            }}
            className="fixed z-50 w-40 rounded-xl border border-gray-100 bg-white py-1.5 shadow-xl dark:border-gray-700 dark:bg-gray-800"
            style={{ top: menuPosition.y, left: menuPosition.x }}
          >
            <button
              role="menuitem"
              onClick={handlePlay}
              disabled={!selectedDialogue.audioUrl}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <Play className="h-4 w-4" /> Play
            </button>
            <button
              role="menuitem"
              onClick={handleEdit}
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <Edit3 className="h-4 w-4" /> Edit
            </button>
            <button
              role="menuitem"
              onClick={handleRegenerate}
              disabled={
                selectedDialogue
                  ? generatingIds.has(selectedDialogue.id)
                  : false
              }
              className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-gray-700/50"
            >
              <RefreshCw
                className={cn(
                  'h-4 w-4',
                  selectedDialogue &&
                    generatingIds.has(selectedDialogue.id) &&
                    'animate-spin',
                )}
              />
              {selectedDialogue && generatingIds.has(selectedDialogue.id)
                ? 'Generating...'
                : 'Regenerate'}
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
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit dialogue"
            className="fixed top-1/2 left-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-4 shadow-2xl dark:border-gray-700 dark:bg-gray-800"
          >
            <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
              Edit Dialogue
            </h3>
            <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">
              {selectedDialogue.characterName}
            </p>
            <textarea
              autoFocus
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
