# FILM-506: Dialogue List Component

**Phase**: 5
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-505 (Audio Studio)
**Blocks**: None

---

## Context

The Dialogue List component displays all dialogue lines for an episode in a structured, interactive list. Each line shows the character name, dialogue text, audio status, and playback controls. Users can play individual audio files, regenerate failed lines, and monitor generation progress in real-time.

This component is crucial for managing episode dialogue efficiently. It must handle large lists (100+ lines), provide intuitive status indicators, support filtering and search, and integrate seamlessly with the voice generation system. The UI should be clean, scannable, and provide quick access to common actions.

---

## Requirements

### Functional Requirements

1. **Dialogue Line Display**
   - Show character avatar/name
   - Display full dialogue text
   - Show sequence number
   - Display audio status badge
   - Show timestamp/duration
   - Highlight selected line

2. **Audio Controls**
   - Play button (with audio preview)
   - Pause button (when playing)
   - Regenerate button
   - Download audio button
   - Show waveform thumbnail

3. **Status Indicators**
   - Pending: Gray badge, "No audio"
   - Generating: Blue spinner, progress
   - Completed: Green checkmark, duration
   - Failed: Red X, error message
   - Visual loading states

4. **Batch Actions**
   - Select multiple lines (checkbox)
   - "Generate All Pending" button
   - "Regenerate All Failed" button
   - Bulk delete audio
   - Show total selection count

5. **Filtering & Search**
   - Filter by character
   - Filter by status
   - Search dialogue text
   - Clear filters button
   - Show result count

6. **Sorting**
   - Sort by sequence number (default)
   - Sort by status
   - Sort by character
   - Sort by duration

### Non-Functional Requirements

- Render 100 lines within 1 second
- Smooth scrolling without jank
- Accessible (keyboard navigation, screen readers)
- Responsive layout (mobile-friendly)
- Optimistic UI updates

---

## Interface

### Component Structure

```typescript
'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Pause, RefreshCw, Download, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Button } from '@kit/ui/button';
import { Badge } from '@kit/ui/badge';
import { Input } from '@kit/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Checkbox } from '@kit/ui/checkbox';
import { toast } from '@kit/ui/sonner';
import {
  generateVoiceAction,
  batchGenerateDialogueAction,
} from '@kit/audio-generation/server';
import type { DialogueLine, Asset } from '@kit/audio-generation/types';

interface DialogueListProps {
  episodeId: string;
  dialogueLines: DialogueLine[];
  characters: Asset[];
  onPlay: (audioUrl: string) => void;
  onPause: () => void;
}

export function DialogueList({
  episodeId,
  dialogueLines,
  characters,
  onPlay,
  onPause,
}: DialogueListProps) {
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [filterCharacter, setFilterCharacter] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'sequence' | 'status' | 'character'>('sequence');
  const [playingLineId, setPlayingLineId] = useState<string | null>(null);

  const queryClient = useQueryClient();

  // Filter and sort dialogue lines
  const filteredLines = useMemo(() => {
    let filtered = dialogueLines;

    // Apply search filter
    if (searchText) {
      filtered = filtered.filter(line =>
        line.text.toLowerCase().includes(searchText.toLowerCase())
      );
    }

    // Apply character filter
    if (filterCharacter !== 'all') {
      filtered = filtered.filter(line =>
        line.characterAssetId === filterCharacter
      );
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(line =>
        line.status === filterStatus
      );
    }

    // Sort
    if (sortBy === 'sequence') {
      filtered = [...filtered].sort((a, b) => a.sequenceNumber - b.sequenceNumber);
    } else if (sortBy === 'status') {
      filtered = [...filtered].sort((a, b) => a.status.localeCompare(b.status));
    } else if (sortBy === 'character') {
      filtered = [...filtered].sort((a, b) => {
        const charA = characters.find(c => c.id === a.characterAssetId)?.name || '';
        const charB = characters.find(c => c.id === b.characterAssetId)?.name || '';
        return charA.localeCompare(charB);
      });
    }

    return filtered;
  }, [dialogueLines, searchText, filterCharacter, filterStatus, sortBy, characters]);

  // Regenerate single line
  const regenerateMutation = useMutation({
    mutationFn: (dialogueLineId: string) =>
      generateVoiceAction({ dialogueLineId, overwriteExisting: true }),
    onSuccess: () => {
      toast.success('Audio regenerated successfully');
      queryClient.invalidateQueries({ queryKey: ['dialogue-lines', episodeId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to regenerate: ${error.message}`);
    },
  });

  // Batch generate
  const batchGenerateMutation = useMutation({
    mutationFn: () =>
      batchGenerateDialogueAction({ episodeId }),
    onSuccess: (result) => {
      toast.success(`Batch generation started: ${result.totalLines} lines`);
      queryClient.invalidateQueries({ queryKey: ['dialogue-lines', episodeId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to start batch generation: ${error.message}`);
    },
  });

  const handlePlay = (line: DialogueLine) => {
    if (!line.audioUrl) return;
    setPlayingLineId(line.id);
    onPlay(line.audioUrl);
  };

  const handlePause = () => {
    setPlayingLineId(null);
    onPause();
  };

  const handleRegenerate = (lineId: string) => {
    regenerateMutation.mutate(lineId);
  };

  const handleBatchGenerate = () => {
    batchGenerateMutation.mutate();
  };

  const handleSelectLine = (lineId: string, checked: boolean) => {
    const newSelection = new Set(selectedLines);
    if (checked) {
      newSelection.add(lineId);
    } else {
      newSelection.delete(lineId);
    }
    setSelectedLines(newSelection);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedLines(new Set(filteredLines.map(line => line.id)));
    } else {
      setSelectedLines(new Set());
    }
  };

  const getCharacterName = (characterAssetId: string | null) => {
    if (!characterAssetId) return 'Narrator';
    return characters.find(c => c.id === characterAssetId)?.name || 'Unknown';
  };

  const getStatusBadge = (line: DialogueLine) => {
    switch (line.status) {
      case 'pending':
        return (
          <Badge variant="secondary" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Pending
          </Badge>
        );
      case 'generating':
        return (
          <Badge variant="default" className="flex items-center gap-1">
            <div className="h-3 w-3 animate-spin rounded-full border-b-2 border-white"></div>
            Generating
          </Badge>
        );
      case 'completed':
        return (
          <Badge variant="success" className="flex items-center gap-1">
            <CheckCircle className="h-3 w-3" />
            Completed
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive" className="flex items-center gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
    }
  };

  const pendingCount = dialogueLines.filter(l => l.status === 'pending').length;
  const failedCount = dialogueLines.filter(l => l.status === 'failed').length;

  return (
    <div className="space-y-4">
      {/* Header Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button
            onClick={handleBatchGenerate}
            disabled={pendingCount === 0 || batchGenerateMutation.isPending}
          >
            Generate All Pending ({pendingCount})
          </Button>
          {failedCount > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                // TODO: Implement retry failed
              }}
            >
              Retry Failed ({failedCount})
            </Button>
          )}
        </div>

        <div className="text-sm text-gray-600">
          {filteredLines.length} of {dialogueLines.length} lines
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        <Input
          placeholder="Search dialogue..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="max-w-xs"
        />

        <Select value={filterCharacter} onValueChange={setFilterCharacter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Character" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Characters</SelectItem>
            {characters.map(char => (
              <SelectItem key={char.id} value={char.id}>
                {char.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="generating">Generating</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sequence">Sequence</SelectItem>
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="character">Character</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Selection Actions */}
      {selectedLines.size > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 p-3">
          <span className="text-sm font-medium">
            {selectedLines.size} selected
          </span>
          <Button size="sm" variant="outline">
            Generate Selected
          </Button>
          <Button size="sm" variant="outline">
            Delete Audio
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelectedLines(new Set())}>
            Clear Selection
          </Button>
        </div>
      )}

      {/* Dialogue List */}
      <div className="space-y-2">
        {/* Select All Header */}
        <div className="flex items-center gap-3 border-b pb-2">
          <Checkbox
            checked={selectedLines.size === filteredLines.length}
            onCheckedChange={handleSelectAll}
          />
          <div className="flex-1 text-xs font-medium uppercase text-gray-500">
            <span className="w-12">#</span>
            <span className="ml-4">Character</span>
          </div>
          <div className="w-32 text-xs font-medium uppercase text-gray-500">
            Status
          </div>
          <div className="w-32 text-xs font-medium uppercase text-gray-500">
            Actions
          </div>
        </div>

        {/* Lines */}
        {filteredLines.map((line) => (
          <div
            key={line.id}
            className="flex items-start gap-3 rounded-lg border p-3 hover:bg-gray-50"
            data-dialogue-line={line.id}
          >
            {/* Checkbox */}
            <Checkbox
              checked={selectedLines.has(line.id)}
              onCheckedChange={(checked) => handleSelectLine(line.id, checked as boolean)}
            />

            {/* Content */}
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-gray-500">
                  #{line.sequenceNumber}
                </span>
                <span className="text-sm font-medium">
                  {getCharacterName(line.characterAssetId)}
                </span>
              </div>
              <p className="text-sm text-gray-700">
                {line.text}
              </p>
              {line.status === 'failed' && line.generationMetadata?.error && (
                <p className="mt-1 text-xs text-red-600">
                  Error: {line.generationMetadata.error}
                </p>
              )}
            </div>

            {/* Status Badge */}
            <div className="w-32">
              {getStatusBadge(line)}
              {line.generationMetadata?.durationSeconds && (
                <p className="mt-1 text-xs text-gray-500">
                  {line.generationMetadata.durationSeconds}s
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex w-32 gap-1">
              {line.status === 'completed' && line.audioUrl && (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      playingLineId === line.id ? handlePause() : handlePlay(line)
                    }
                    aria-label={playingLineId === line.id ? 'Pause' : 'Play'}
                  >
                    {playingLineId === line.id ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRegenerate(line.id)}
                    aria-label="Regenerate audio"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(line.audioUrl!, '_blank')}
                    aria-label="Download audio"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </>
              )}

              {line.status === 'pending' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRegenerate(line.id)}
                  disabled={regenerateMutation.isPending}
                >
                  Generate
                </Button>
              )}

              {line.status === 'failed' && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRegenerate(line.id)}
                  disabled={regenerateMutation.isPending}
                >
                  Retry
                </Button>
              )}
            </div>
          </div>
        ))}

        {filteredLines.length === 0 && (
          <div className="py-12 text-center text-gray-500">
            No dialogue lines found
          </div>
        )}
      </div>
    </div>
  );
}
```

---

## Implementation Details

### File Structure

```
packages/features/audio-generation/src/
├── components/
│   ├── DialogueList.tsx                  # Main component (CREATE THIS)
│   ├── DialogueLineItem.tsx              # Line item component (CREATE THIS)
│   └── __tests__/
│       └── DialogueList.test.tsx         # Unit tests (CREATE THIS)
```

### Component Variants

**Compact View** (for mobile):
```typescript
<div className="flex flex-col gap-1 p-2">
  <div className="flex items-center justify-between">
    <span className="text-xs font-medium">{character}</span>
    {statusBadge}
  </div>
  <p className="text-sm">{text}</p>
  <div className="flex gap-1">{actions}</div>
</div>
```

**Expanded View** (for desktop):
```typescript
<div className="flex items-start gap-3 p-3">
  <Checkbox />
  <div className="flex-1">
    <div className="flex items-center gap-2">
      <Avatar />
      <span>{character}</span>
    </div>
    <p>{text}</p>
  </div>
  {statusBadge}
  {actions}
</div>
```

---

## File Changes

### New Files

1. **packages/features/audio-generation/src/components/DialogueList.tsx**
   - Main dialogue list component
   - Filtering and sorting logic
   - Batch action controls

2. **packages/features/audio-generation/src/components/DialogueLineItem.tsx**
   - Individual line item component
   - Audio controls
   - Status display

3. **packages/features/audio-generation/src/components/__tests__/DialogueList.test.tsx**
   - Component unit tests
   - Filter and sort tests
   - User interaction tests

### Modified Files

1. **packages/features/audio-generation/src/components/index.ts**
   - Export DialogueList component

---

## Acceptance Criteria

### Functional

- [ ] Displays all dialogue lines
- [ ] Shows character name for each line
- [ ] Shows dialogue text
- [ ] Shows audio status badge
- [ ] Play button works for completed lines
- [ ] Regenerate button works
- [ ] Download button opens audio file
- [ ] Search filters dialogue text
- [ ] Character filter works
- [ ] Status filter works
- [ ] Sort by sequence number works
- [ ] Select individual lines works
- [ ] Select all works
- [ ] Batch generate button triggers action
- [ ] Shows loading states during generation
- [ ] Shows error messages for failed lines

### Non-Functional

- [ ] Renders 100 lines within 1 second
- [ ] Smooth scrolling
- [ ] Keyboard navigation works
- [ ] Accessible (ARIA labels, screen reader)
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/audio-generation/src/components/__tests__/DialogueList.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DialogueList } from '../DialogueList';

const mockLines = [
  {
    id: 'line-1',
    episodeId: 'ep-1',
    characterAssetId: 'char-1',
    text: 'Hello world',
    sequenceNumber: 1,
    status: 'completed',
    audioUrl: 'https://example.com/audio.mp3',
  },
  {
    id: 'line-2',
    episodeId: 'ep-1',
    characterAssetId: 'char-2',
    text: 'Goodbye world',
    sequenceNumber: 2,
    status: 'pending',
    audioUrl: null,
  },
];

const mockCharacters = [
  { id: 'char-1', name: 'Alice' },
  { id: 'char-2', name: 'Bob' },
];

describe('DialogueList', () => {
  it('should render all dialogue lines', () => {
    render(
      <DialogueList
        episodeId="ep-1"
        dialogueLines={mockLines}
        characters={mockCharacters}
        onPlay={vi.fn()}
        onPause={vi.fn()}
      />
    );

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.getByText('Goodbye world')).toBeInTheDocument();
  });

  it('should filter by search text', () => {
    render(
      <DialogueList
        episodeId="ep-1"
        dialogueLines={mockLines}
        characters={mockCharacters}
        onPlay={vi.fn()}
        onPause={vi.fn()}
      />
    );

    const searchInput = screen.getByPlaceholderText('Search dialogue...');
    fireEvent.change(searchInput, { target: { value: 'Hello' } });

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.queryByText('Goodbye world')).not.toBeInTheDocument();
  });

  it('should filter by character', () => {
    render(
      <DialogueList
        episodeId="ep-1"
        dialogueLines={mockLines}
        characters={mockCharacters}
        onPlay={vi.fn()}
        onPause={vi.fn()}
      />
    );

    // Select Alice from dropdown
    const characterSelect = screen.getByRole('combobox', { name: /character/i });
    fireEvent.change(characterSelect, { target: { value: 'char-1' } });

    expect(screen.getByText('Hello world')).toBeInTheDocument();
    expect(screen.queryByText('Goodbye world')).not.toBeInTheDocument();
  });

  it('should call onPlay when play button clicked', () => {
    const onPlay = vi.fn();
    render(
      <DialogueList
        episodeId="ep-1"
        dialogueLines={mockLines}
        characters={mockCharacters}
        onPlay={onPlay}
        onPause={vi.fn()}
      />
    );

    const playButton = screen.getAllByLabelText('Play')[0];
    fireEvent.click(playButton);

    expect(onPlay).toHaveBeenCalledWith('https://example.com/audio.mp3');
  });
});
```

### Manual Testing

1. **Display**
   - Create episode with 50 dialogue lines
   - Verify all lines render
   - Verify scrolling is smooth

2. **Filtering**
   - Search for specific text
   - Filter by character
   - Filter by status
   - Combine multiple filters

3. **Audio Playback**
   - Click play on completed line
   - Verify audio plays
   - Click pause
   - Verify audio stops

4. **Regeneration**
   - Click regenerate on failed line
   - Verify status changes to 'generating'
   - Wait for completion
   - Verify new audio plays

---

## Accessibility

### ARIA Labels

```typescript
<button aria-label="Play dialogue line 1">
  <Play />
</button>

<div role="status" aria-live="polite">
  {line.status === 'generating' && 'Generating audio...'}
</div>
```

### Keyboard Shortcuts

- **Tab**: Navigate between lines
- **Space**: Play/pause selected line
- **Enter**: Regenerate selected line
- **Cmd+A**: Select all lines

---

## Performance Considerations

Use virtualization for large lists:

```typescript
import { FixedSizeList } from 'react-window';

<FixedSizeList
  height={600}
  itemCount={filteredLines.length}
  itemSize={80}
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <DialogueLineItem line={filteredLines[index]} />
    </div>
  )}
</FixedSizeList>
```

---

## Future Enhancements

1. **Inline Editing**
   - Edit dialogue text
   - Auto-regenerate on save

2. **Drag and Drop**
   - Reorder dialogue lines
   - Update sequence numbers

3. **Waveform Thumbnails**
   - Show mini waveform per line
   - Visual audio quality indicator

4. **Batch Export**
   - Export all dialogue as ZIP
   - Export with metadata CSV

---

## References

- **FILM-502**: Voice Generation Action
- **FILM-503**: Batch Dialogue Action
- **FILM-505**: Audio Studio Component
- **Constitution**: Section 8 (Accessibility)
