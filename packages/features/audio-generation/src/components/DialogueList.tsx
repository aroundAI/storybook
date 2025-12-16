'use client';

import * as React from 'react';
import { useCallback, useMemo, useState, useTransition } from 'react';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle,
  Clock,
  Download,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import type {
  CharacterAsset,
  DialogueLine,
  DialogueLineSummary,
} from '../lib/types/dialogue.types';
import { batchGenerateDialogueAction } from '../server/batch-actions';
import { generateDialogueVoiceAction } from '../server/voice-actions';

export interface DialogueListProps {
  /** Episode ID for batch operations */
  episodeId: string;
  /** List of dialogue lines */
  dialogueLines: DialogueLine[];
  /** Characters for filtering */
  characters: CharacterAsset[];
  /** Callback when play is requested */
  onPlay: (audioUrl: string, lineId: string) => void;
  /** Callback when pause is requested */
  onPause: () => void;
  /** ID of the currently playing line */
  playingLineId?: string | null;
  /** Optional additional CSS classes */
  className?: string;
}

type SortOption = 'sequence' | 'status' | 'character';
type StatusFilter = 'all' | 'pending' | 'generating' | 'completed' | 'failed';

/** Special value for narrator filter */
const NARRATOR_FILTER_VALUE = '__narrator__';

interface DialogueListUIState {
  selectedLines: Set<string>;
  searchText: string;
  filterCharacter: string;
  filterStatus: StatusFilter;
  sortBy: SortOption;
}

/**
 * Get character name from ID
 */
function getCharacterName(
  characterId: string | null,
  characters: CharacterAsset[],
): string {
  if (!characterId) return 'Narrator';
  const character = characters.find((c) => c.id === characterId);
  return character?.name ?? 'Unknown';
}

/**
 * Status badge component for dialogue line status - using semantic colors
 */
function StatusBadge({ status }: { status: DialogueLine['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <Badge className="status-pending gap-1">
          <Clock className="h-3 w-3" />
          Pending
        </Badge>
      );
    case 'generating':
      return (
        <Badge className="status-processing gap-1">
          <Loader2 className="h-3 w-3 animate-spin" />
          Generating
        </Badge>
      );
    case 'completed':
      return (
        <Badge className="status-complete gap-1">
          <CheckCircle className="h-3 w-3" />
          Completed
        </Badge>
      );
    case 'failed':
      return (
        <Badge className="status-error gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
  }
}

/**
 * DialogueList displays dialogue lines with voice assignments and playback controls
 *
 * Features:
 * - Filter by character, status, and search text
 * - Sort by sequence number, status, or character
 * - Multi-select for batch operations
 * - Play/pause audio controls
 * - Regenerate single lines or batch generate all pending
 */
export function DialogueList({
  episodeId,
  dialogueLines,
  characters,
  onPlay,
  onPause,
  playingLineId,
  className,
}: DialogueListProps) {
  // Consolidated UI state to follow CLAUDE.md guidelines
  const [uiState, setUIState] = useState<DialogueListUIState>({
    selectedLines: new Set(),
    searchText: '',
    filterCharacter: 'all',
    filterStatus: 'all',
    sortBy: 'sequence',
  });
  const [isPending, startTransition] = useTransition();

  const queryClient = useQueryClient();

  // Destructure for easier access
  const { selectedLines, searchText, filterCharacter, filterStatus, sortBy } =
    uiState;

  // State update helpers
  const setSelectedLines = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      setUIState((prev) => ({
        ...prev,
        selectedLines:
          typeof updater === 'function' ? updater(prev.selectedLines) : updater,
      }));
    },
    [],
  );

  const setSearchText = useCallback((value: string) => {
    setUIState((prev) => ({ ...prev, searchText: value }));
  }, []);

  const setFilterCharacter = useCallback((value: string) => {
    setUIState((prev) => ({ ...prev, filterCharacter: value }));
  }, []);

  const setFilterStatus = useCallback((value: StatusFilter) => {
    setUIState((prev) => ({ ...prev, filterStatus: value }));
  }, []);

  const setSortBy = useCallback((value: SortOption) => {
    setUIState((prev) => ({ ...prev, sortBy: value }));
  }, []);

  // Regenerate single line mutation
  const regenerateMutation = useMutation({
    mutationFn: async (lineId: string) => {
      const line = dialogueLines.find((l) => l.id === lineId);
      if (!line) throw new Error('Dialogue line not found');

      return generateDialogueVoiceAction({
        dialogueLineId: lineId,
        overwriteExisting: true,
      });
    },
    onSuccess: (
      result: Awaited<ReturnType<typeof generateDialogueVoiceAction>>,
    ) => {
      if (result.status === 'completed') {
        toast.success('Audio regenerated successfully');
        queryClient.invalidateQueries({
          queryKey: ['dialogue-lines', episodeId],
        });
      } else {
        toast.error(result.error ?? 'Failed to regenerate audio');
      }
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Failed to regenerate');
    },
  });

  // Batch generate mutation
  const batchGenerateMutation = useMutation({
    mutationFn: async () => {
      return batchGenerateDialogueAction({
        episodeId,
        overwriteExisting: false,
      });
    },
    onSuccess: (
      result: Awaited<ReturnType<typeof batchGenerateDialogueAction>>,
    ) => {
      toast.success(
        `Batch generation started for ${result.totalLines} lines. Estimated cost: $${(result.estimatedCost / 100).toFixed(2)}`,
      );
      queryClient.invalidateQueries({
        queryKey: ['dialogue-lines', episodeId],
      });
    },
    onError: (error: Error) => {
      toast.error(error.message ?? 'Failed to start batch generation');
    },
  });

  // Calculate summary
  const summary: DialogueLineSummary = useMemo(() => {
    return {
      total: dialogueLines.length,
      pending: dialogueLines.filter((l) => l.status === 'pending').length,
      generating: dialogueLines.filter((l) => l.status === 'generating').length,
      completed: dialogueLines.filter((l) => l.status === 'completed').length,
      failed: dialogueLines.filter((l) => l.status === 'failed').length,
    };
  }, [dialogueLines]);

  // Filter and sort lines
  const filteredLines = useMemo(() => {
    let result = [...dialogueLines];

    // Apply search filter
    if (searchText.trim()) {
      const search = searchText.toLowerCase();
      result = result.filter(
        (line) =>
          line.text.toLowerCase().includes(search) ||
          getCharacterName(line.characterAssetId, characters)
            .toLowerCase()
            .includes(search),
      );
    }

    // Apply character filter
    if (filterCharacter !== 'all') {
      if (filterCharacter === NARRATOR_FILTER_VALUE) {
        // Filter for narrator lines (null characterAssetId)
        result = result.filter((line) => line.characterAssetId === null);
      } else {
        result = result.filter(
          (line) => line.characterAssetId === filterCharacter,
        );
      }
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      result = result.filter((line) => line.status === filterStatus);
    }

    // Apply sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'sequence':
          return a.sequenceNumber - b.sequenceNumber;
        case 'status': {
          const statusOrder = {
            pending: 0,
            generating: 1,
            failed: 2,
            completed: 3,
          };
          return statusOrder[a.status] - statusOrder[b.status];
        }
        case 'character': {
          const nameA = getCharacterName(a.characterAssetId, characters);
          const nameB = getCharacterName(b.characterAssetId, characters);
          return nameA.localeCompare(nameB);
        }
        default:
          return 0;
      }
    });

    return result;
  }, [
    dialogueLines,
    searchText,
    filterCharacter,
    filterStatus,
    sortBy,
    characters,
  ]);

  // Selection handlers
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        setSelectedLines(new Set(filteredLines.map((l) => l.id)));
      } else {
        setSelectedLines(new Set());
      }
    },
    [filteredLines, setSelectedLines],
  );

  const handleSelectLine = useCallback(
    (lineId: string, checked: boolean) => {
      setSelectedLines((prev) => {
        const next = new Set(prev);
        if (checked) {
          next.add(lineId);
        } else {
          next.delete(lineId);
        }
        return next;
      });
    },
    [setSelectedLines],
  );

  // Audio handlers
  const handlePlayPause = useCallback(
    (line: DialogueLine) => {
      if (playingLineId === line.id) {
        onPause();
      } else if (line.audioUrl) {
        onPlay(line.audioUrl, line.id);
      }
    },
    [playingLineId, onPlay, onPause],
  );

  // Download handler
  const handleDownload = useCallback(
    async (audioUrl: string, lineId: string) => {
      try {
        // Fetch the audio file to ensure it exists
        const response = await fetch(audioUrl);
        if (!response.ok) {
          throw new Error('Failed to fetch audio file');
        }

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `dialogue-${lineId}.mp3`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL
        URL.revokeObjectURL(blobUrl);
      } catch {
        toast.error('Failed to download audio file');
      }
    },
    [],
  );

  // Regenerate handler
  const handleRegenerate = useCallback(
    (lineId: string) => {
      startTransition(() => {
        regenerateMutation.mutate(lineId);
      });
    },
    [regenerateMutation],
  );

  // Batch generate handler
  const handleBatchGenerate = useCallback(() => {
    if (summary.pending === 0 && summary.failed === 0) {
      toast.info('No pending or failed lines to generate');
      return;
    }
    startTransition(() => {
      batchGenerateMutation.mutate();
    });
  }, [batchGenerateMutation, summary.pending, summary.failed]);

  const isSelectAllChecked =
    filteredLines.length > 0 && selectedLines.size === filteredLines.length;
  const isSelectAllIndeterminate =
    selectedLines.size > 0 && selectedLines.size < filteredLines.length;

  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      data-test="dialogue-list"
    >
      {/* Header with summary */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-sm">
            {summary.total} lines:
          </span>
          <Badge variant="success">{summary.completed} completed</Badge>
          <Badge variant="secondary">{summary.pending} pending</Badge>
          {summary.generating > 0 && (
            <Badge variant="info">{summary.generating} generating</Badge>
          )}
          {summary.failed > 0 && (
            <Badge variant="destructive">{summary.failed} failed</Badge>
          )}
        </div>
        <Button
          onClick={handleBatchGenerate}
          disabled={
            batchGenerateMutation.isPending ||
            isPending ||
            (summary.pending === 0 && summary.failed === 0)
          }
          data-test="batch-generate-button"
        >
          {batchGenerateMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Generate All Pending
            </>
          )}
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[200px] flex-1">
          <Search className="text-muted-foreground absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
          <Input
            placeholder="Search dialogue..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pl-9"
            data-test="dialogue-search"
          />
        </div>

        {/* Character filter */}
        <Select value={filterCharacter} onValueChange={setFilterCharacter}>
          <SelectTrigger className="w-[180px]" data-test="character-filter">
            <SelectValue placeholder="Filter by character" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Characters</SelectItem>
            <SelectItem value={NARRATOR_FILTER_VALUE}>Narrator</SelectItem>
            {characters.map((char) => (
              <SelectItem key={char.id} value={char.id}>
                {char.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Status filter */}
        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v as StatusFilter)}
        >
          <SelectTrigger className="w-[150px]" data-test="status-filter">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="generating">Generating</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        {/* Sort */}
        <Select
          value={sortBy}
          onValueChange={(v) => setSortBy(v as SortOption)}
        >
          <SelectTrigger className="w-[150px]" data-test="sort-select">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sequence">Sequence</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="character">Character</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Dialogue lines list */}
      <div className="rounded-md border">
        {/* Table header */}
        <div className="bg-muted/50 flex items-center gap-4 border-b px-4 py-3">
          <Checkbox
            checked={
              isSelectAllIndeterminate ? 'indeterminate' : isSelectAllChecked
            }
            onCheckedChange={handleSelectAll}
            aria-label="Select all dialogue lines"
            data-test="select-all-checkbox"
          />
          <span className="text-muted-foreground w-12 text-sm font-medium">
            #
          </span>
          <span className="text-muted-foreground flex-1 text-sm font-medium">
            Dialogue
          </span>
          <span className="text-muted-foreground w-32 text-sm font-medium">
            Character
          </span>
          <span className="text-muted-foreground w-28 text-sm font-medium">
            Status
          </span>
          <span className="text-muted-foreground w-32 text-sm font-medium">
            Actions
          </span>
        </div>

        {/* Dialogue lines */}
        {filteredLines.length === 0 ? (
          <div className="text-muted-foreground flex items-center justify-center py-8">
            No dialogue lines found
          </div>
        ) : (
          <div className="divide-y">
            {filteredLines.map((line) => (
              <div
                key={line.id}
                className={cn(
                  'flex items-center gap-4 px-4 py-3 transition-colors',
                  selectedLines.has(line.id) && 'bg-muted/30',
                  playingLineId === line.id && 'bg-primary/5',
                )}
                data-test={`dialogue-line-${line.id}`}
              >
                {/* Selection checkbox */}
                <Checkbox
                  checked={selectedLines.has(line.id)}
                  onCheckedChange={(checked) =>
                    handleSelectLine(line.id, checked === true)
                  }
                  aria-label={`Select dialogue line ${line.sequenceNumber}`}
                />

                {/* Sequence number */}
                <span className="text-muted-foreground w-12 text-sm tabular-nums">
                  {line.sequenceNumber}
                </span>

                {/* Dialogue text */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{line.text}</p>
                  {line.status === 'failed' &&
                    line.generationMetadata?.error && (
                      <p className="text-destructive mt-1 truncate text-xs">
                        {line.generationMetadata.error}
                      </p>
                    )}
                </div>

                {/* Character name */}
                <span className="text-muted-foreground w-32 truncate text-sm">
                  {getCharacterName(line.characterAssetId, characters)}
                </span>

                {/* Status badge */}
                <div className="w-28">
                  <StatusBadge status={line.status} />
                </div>

                {/* Actions */}
                <div className="flex w-32 items-center gap-1">
                  {/* Play/Pause */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handlePlayPause(line)}
                    disabled={!line.audioUrl}
                    aria-label={
                      playingLineId === line.id ? 'Pause audio' : 'Play audio'
                    }
                    data-test={`play-button-${line.id}`}
                  >
                    {playingLineId === line.id ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>

                  {/* Regenerate */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRegenerate(line.id)}
                    disabled={
                      regenerateMutation.isPending ||
                      line.status === 'generating'
                    }
                    aria-label="Regenerate audio"
                    data-test={`regenerate-button-${line.id}`}
                  >
                    {regenerateMutation.isPending &&
                    regenerateMutation.variables === line.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                  </Button>

                  {/* Download */}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      line.audioUrl && handleDownload(line.audioUrl, line.id)
                    }
                    disabled={!line.audioUrl}
                    aria-label="Download audio"
                    data-test={`download-button-${line.id}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Selection actions */}
      {selectedLines.size > 0 && (
        <div className="bg-muted/50 flex items-center justify-between rounded-md border px-4 py-3">
          <span className="text-sm">
            {selectedLines.size} line{selectedLines.size !== 1 ? 's' : ''}{' '}
            selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedLines(new Set())}
          >
            Clear Selection
          </Button>
        </div>
      )}
    </div>
  );
}
