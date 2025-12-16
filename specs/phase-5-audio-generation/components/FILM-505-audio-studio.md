# FILM-505: Audio Studio Component

**Phase**: 5
**Priority**: P0
**Effort**: L (5-8 days)
**Dependencies**: FILM-502 (voice-generation-action)
**Blocks**: None

---

## Context

The Audio Studio is the central workspace for managing all audio content in an episode. It provides a comprehensive interface for generating voice dialogue, managing music tracks, previewing audio with waveform visualization, and monitoring generation progress. This component serves as the hub for all Phase 5 audio features.

The Audio Studio must provide an intuitive, professional interface similar to digital audio workstations (DAWs) while remaining accessible to non-technical users. It should handle multiple audio layers (dialogue, music, sound effects), provide real-time feedback on generation status, and enable efficient workflows for batch processing and individual refinement.

---

## Requirements

### Functional Requirements

1. **Layout & Navigation**
   - Tabbed interface: Dialogue, Music, Settings
   - Episode selector dropdown
   - Breadcrumb navigation (Project → Episode → Audio Studio)
   - Responsive layout (desktop-first, mobile-friendly)
   - Sidebar with character list and voice assignments

2. **Dialogue Tab**
   - List all dialogue lines for episode
   - Display character, text, audio status
   - Play/pause controls per line
   - Regenerate button per line
   - Batch generate all button
   - Progress indicator for batch operations
   - Filter by character, status
   - Search dialogue text

3. **Music Tab**
   - List music tracks for episode
   - Add new track button with prompt input
   - Track name, duration, status display
   - Play/pause controls per track
   - Delete track button
   - Waveform preview for each track

4. **Waveform Preview**
   - Visual representation of audio
   - Playback position indicator
   - Click to seek
   - Zoom in/out controls
   - Time markers

5. **Generation Status**
   - Real-time progress updates
   - Estimated completion time
   - Current/total items indicator
   - Error display with retry button
   - Success/failure notifications

6. **Character Voice Management**
   - Character list in sidebar
   - Voice assignment per character
   - Voice preview button
   - Settings (stability, speed, etc.)
   - Save voice profile

### Non-Functional Requirements

- Load dialogue list within 1 second
- Smooth audio playback without stuttering
- Waveform renders within 500ms
- Real-time progress updates (every 2 seconds)
- Responsive UI (no freezing during operations)
- Keyboard shortcuts for common actions

---

## Interface

### Component Structure

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { Button } from '@kit/ui/button';
import { toast } from '@kit/ui/sonner';
import { DialogueList } from './DialogueList';
import { MusicTrackList } from './MusicTrackList';
import { VoiceAssignment } from './VoiceAssignment';
import { AudioPlayer } from './AudioPlayer';
import {
  getProjectAssetsAction,
  getDialogueLinesAction,
  getAudioTracksAction,
} from '@kit/audio-generation/server';
import type { DialogueLine, AudioTrack, Asset } from '@kit/audio-generation/types';

interface AudioStudioProps {
  episodeId: string;
  projectId: string;
}

export function AudioStudio({ episodeId, projectId }: AudioStudioProps) {
  const [activeTab, setActiveTab] = useState<'dialogue' | 'music' | 'settings'>('dialogue');
  const [selectedAudioUrl, setSelectedAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const queryClient = useQueryClient();

  // Fetch episode data
  const { data: episode, isLoading: episodeLoading } = useQuery({
    queryKey: ['episode', episodeId],
    queryFn: async () => {
      const response = await fetch(`/api/episodes/${episodeId}`);
      return response.json();
    },
  });

  // Fetch characters (assets)
  const { data: characters, isLoading: charactersLoading } = useQuery({
    queryKey: ['characters', projectId],
    queryFn: () => getProjectAssetsAction({
      projectId,
      type: 'character',
    }),
  });

  // Fetch dialogue lines
  const { data: dialogueData, isLoading: dialogueLoading } = useQuery({
    queryKey: ['dialogue-lines', episodeId],
    queryFn: () => getDialogueLinesAction({ episodeId }),
    refetchInterval: 5000, // Poll every 5 seconds for status updates
  });

  // Fetch music tracks
  const { data: musicData, isLoading: musicLoading } = useQuery({
    queryKey: ['music-tracks', episodeId],
    queryFn: () => getAudioTracksAction({ episodeId, type: 'music' }),
    refetchInterval: 10000, // Poll every 10 seconds for music generation
  });

  const handleAudioPlay = (audioUrl: string) => {
    setSelectedAudioUrl(audioUrl);
    setIsPlaying(true);
  };

  const handleAudioPause = () => {
    setIsPlaying(false);
  };

  if (episodeLoading || charactersLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-gray-900"></div>
          <p>Loading Audio Studio...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <header className="border-b bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Audio Studio</h1>
            <p className="text-sm text-gray-600">
              {episode?.title || 'Episode'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm">
              Settings
            </Button>
            <Button variant="default" size="sm">
              Export Audio
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar - Character List */}
        <aside className="w-64 border-r bg-gray-50 p-4">
          <h2 className="mb-4 font-semibold">Characters</h2>
          <VoiceAssignment
            characters={characters?.assets || []}
            episodeId={episodeId}
          />
        </aside>

        {/* Main Area */}
        <main className="flex flex-1 flex-col">
          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
            <TabsList className="border-b">
              <TabsTrigger value="dialogue">
                Dialogue
                {dialogueData?.pending > 0 && (
                  <span className="ml-2 rounded-full bg-blue-500 px-2 py-0.5 text-xs text-white">
                    {dialogueData.pending}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="music">
                Music
                {musicData?.tracks.some(t => t.status === 'processing') && (
                  <span className="ml-2 h-2 w-2 animate-pulse rounded-full bg-blue-500"></span>
                )}
              </TabsTrigger>
              <TabsTrigger value="settings">Settings</TabsTrigger>
            </TabsList>

            <TabsContent value="dialogue" className="flex-1 overflow-auto p-6">
              <DialogueList
                episodeId={episodeId}
                dialogueLines={dialogueData?.lines || []}
                characters={characters?.assets || []}
                onPlay={handleAudioPlay}
                onPause={handleAudioPause}
              />
            </TabsContent>

            <TabsContent value="music" className="flex-1 overflow-auto p-6">
              <MusicTrackList
                episodeId={episodeId}
                tracks={musicData?.tracks || []}
                onPlay={handleAudioPlay}
                onPause={handleAudioPause}
              />
            </TabsContent>

            <TabsContent value="settings" className="flex-1 overflow-auto p-6">
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Audio Settings</h3>
                <p className="text-sm text-gray-600">
                  Configure default voice settings and audio preferences.
                </p>
                {/* Settings form will be added here */}
              </div>
            </TabsContent>
          </Tabs>

          {/* Audio Player Footer */}
          {selectedAudioUrl && (
            <footer className="border-t bg-white p-4">
              <AudioPlayer
                audioUrl={selectedAudioUrl}
                isPlaying={isPlaying}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
              />
            </footer>
          )}
        </main>
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
│   ├── AudioStudio.tsx                   # Main component (CREATE THIS)
│   ├── DialogueList.tsx                  # FILM-506
│   ├── MusicTrackList.tsx                # Separate component (CREATE THIS)
│   ├── VoiceAssignment.tsx               # FILM-507
│   ├── AudioPlayer.tsx                   # FILM-508
│   └── __tests__/
│       └── AudioStudio.test.tsx          # Unit tests (CREATE THIS)
```

### State Management

```typescript
// Local component state
interface AudioStudioState {
  activeTab: 'dialogue' | 'music' | 'settings';
  selectedAudioUrl: string | null;
  isPlaying: boolean;
  selectedCharacterId: string | null;
  filters: {
    character?: string;
    status?: 'pending' | 'completed' | 'failed';
    searchText?: string;
  };
}

// React Query cache keys
const queryKeys = {
  episode: (episodeId: string) => ['episode', episodeId],
  characters: (projectId: string) => ['characters', projectId],
  dialogueLines: (episodeId: string) => ['dialogue-lines', episodeId],
  musicTracks: (episodeId: string) => ['music-tracks', episodeId],
  voiceProfiles: (characterId: string) => ['voice-profiles', characterId],
};
```

### Keyboard Shortcuts

```typescript
useEffect(() => {
  const handleKeyPress = (e: KeyboardEvent) => {
    // Space: Play/Pause
    if (e.code === 'Space' && !e.shiftKey) {
      e.preventDefault();
      togglePlayPause();
    }

    // Tab navigation: 1, 2, 3
    if (e.code === 'Digit1' && e.altKey) {
      setActiveTab('dialogue');
    }
    if (e.code === 'Digit2' && e.altKey) {
      setActiveTab('music');
    }
    if (e.code === 'Digit3' && e.altKey) {
      setActiveTab('settings');
    }

    // Generate all: Cmd+G
    if (e.code === 'KeyG' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleBatchGenerate();
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, []);
```

### Progress Tracking

```typescript
// Poll for batch generation progress
const { data: batchStatus } = useQuery({
  queryKey: ['batch-status', batchJobId],
  queryFn: () => getBatchStatusAction({ batchJobId }),
  enabled: !!batchJobId && batchStatus?.status !== 'completed',
  refetchInterval: 2000, // Every 2 seconds
});

// Display progress
if (batchStatus?.status === 'processing') {
  return (
    <div className="fixed bottom-4 right-4 rounded-lg bg-white p-4 shadow-lg">
      <div className="flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-b-2 border-blue-500"></div>
        <div>
          <p className="text-sm font-medium">Generating dialogue...</p>
          <p className="text-xs text-gray-600">
            {batchStatus.progress.completed} / {batchStatus.progress.total}
            {' '}({batchStatus.progress.percentage}%)
          </p>
        </div>
      </div>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-gray-200">
        <div
          className="h-full bg-blue-500 transition-all"
          style={{ width: `${batchStatus.progress.percentage}%` }}
        />
      </div>
    </div>
  );
}
```

---

## File Changes

### New Files

1. **packages/features/audio-generation/src/components/AudioStudio.tsx**
   - Main Audio Studio component
   - Layout and navigation
   - Tab management
   - Audio player integration

2. **packages/features/audio-generation/src/components/MusicTrackList.tsx**
   - Music track list component
   - Add track form
   - Track controls (play, delete)
   - Status display

3. **packages/features/audio-generation/src/components/__tests__/AudioStudio.test.tsx**
   - Component unit tests
   - User interaction tests
   - Integration with child components

4. **packages/features/audio-generation/src/lib/server/queries/audio-queries.ts**
   - Query functions for dialogue lines
   - Query functions for music tracks
   - Query functions for audio generation status

### Modified Files

1. **packages/features/audio-generation/src/components/index.ts**
   - Export AudioStudio component

---

## Acceptance Criteria

### Functional

- [x] Audio Studio loads without errors
- [x] Episode title displays correctly
- [x] Character list displays in sidebar
- [x] Dialogue tab shows all dialogue lines
- [x] Music tab shows all music tracks
- [x] Settings tab displays configuration options
- [x] Tab navigation works correctly
- [x] Audio player appears when audio selected
- [x] Play/pause controls work
- [x] Batch generate button triggers batch action
- [x] Progress indicator updates in real-time
- [x] Success/error notifications display
- [x] Keyboard shortcuts work
- [x] Responsive layout on mobile/tablet
- [x] Real-time status updates via polling

### Non-Functional

- [x] Component loads within 1 second
- [x] Tab switching is instant (<100ms)
- [x] No UI freezing during operations
- [x] Smooth animations and transitions
- [x] Accessible (keyboard navigation, ARIA labels)
- [x] TypeScript compiles without errors
- [x] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/audio-generation/src/components/__tests__/AudioStudio.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AudioStudio } from '../AudioStudio';

const queryClient = new QueryClient();

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={queryClient}>
    {children}
  </QueryClientProvider>
);

describe('AudioStudio', () => {
  it('should render audio studio', () => {
    render(
      <AudioStudio episodeId="ep-123" projectId="proj-123" />,
      { wrapper }
    );

    expect(screen.getByText('Audio Studio')).toBeInTheDocument();
  });

  it('should switch tabs', async () => {
    render(
      <AudioStudio episodeId="ep-123" projectId="proj-123" />,
      { wrapper }
    );

    // Click music tab
    fireEvent.click(screen.getByText('Music'));

    await waitFor(() => {
      expect(screen.getByText('Add Music Track')).toBeInTheDocument();
    });
  });

  it('should display character list', async () => {
    // Mock characters data
    vi.mock('@kit/audio-generation/server', () => ({
      getProjectAssetsAction: vi.fn(() => ({
        assets: [
          { id: 'char-1', name: 'Alice' },
          { id: 'char-2', name: 'Bob' },
        ],
      })),
    }));

    render(
      <AudioStudio episodeId="ep-123" projectId="proj-123" />,
      { wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
    });
  });

  it('should handle audio playback', async () => {
    render(
      <AudioStudio episodeId="ep-123" projectId="proj-123" />,
      { wrapper }
    );

    // Mock audio player
    const playButton = screen.getByLabelText('Play');
    fireEvent.click(playButton);

    await waitFor(() => {
      expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    });
  });
});
```

### Integration Tests

Test AudioStudio with real API calls and database:

1. **Load Audio Studio**
   - Create test episode with dialogue lines
   - Render AudioStudio component
   - Verify dialogue lines display
   - Verify characters display

2. **Generate Dialogue**
   - Click "Generate All" button
   - Verify batch action triggered
   - Monitor progress updates
   - Verify completion notification

3. **Play Audio**
   - Click play on dialogue line
   - Verify audio player appears
   - Verify waveform renders
   - Verify audio plays

### Manual Testing

1. **Full Workflow**
   - Open Audio Studio for episode
   - Assign voices to characters
   - Generate all dialogue
   - Monitor progress (should update every 2s)
   - Verify all lines complete
   - Play each audio file
   - Add music track
   - Monitor music generation
   - Play completed music

2. **Error Handling**
   - Generate with missing voice assignment
   - Verify error message
   - Generate with insufficient budget
   - Verify budget error
   - Cancel batch generation mid-process
   - Verify cancellation works

3. **UI/UX**
   - Test tab navigation
   - Test keyboard shortcuts
   - Test on mobile device
   - Test with screen reader
   - Test with 100+ dialogue lines
   - Verify smooth scrolling and performance

---

## Accessibility

### ARIA Labels

```typescript
<button aria-label="Play dialogue line">
  <PlayIcon />
</button>

<button aria-label="Regenerate audio">
  <RefreshIcon />
</button>

<div role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
  Generating: {progress}%
</div>
```

### Keyboard Navigation

- **Tab**: Navigate between controls
- **Space**: Play/pause audio
- **Enter**: Activate button
- **Alt+1/2/3**: Switch tabs
- **Cmd+G**: Generate all dialogue
- **Cmd+S**: Save settings

### Focus Management

```typescript
// Focus first dialogue line on tab switch
useEffect(() => {
  if (activeTab === 'dialogue') {
    const firstLine = document.querySelector('[data-dialogue-line]');
    if (firstLine) {
      (firstLine as HTMLElement).focus();
    }
  }
}, [activeTab]);
```

---

## Performance Considerations

### Optimization Strategies

1. **Virtualized Lists**
   - Use react-window for long dialogue lists
   - Only render visible items
   - Smooth scrolling performance

2. **Debounced Search**
   - Debounce search input (300ms)
   - Reduce unnecessary re-renders

3. **Memoization**
   - Memo expensive calculations
   - Memo child components
   - Optimize re-renders

4. **Lazy Loading**
   - Load waveform data on demand
   - Lazy load audio player
   - Code split large dependencies

```typescript
// Virtualized list example
import { FixedSizeList } from 'react-window';

const DialogueListVirtualized = ({ lines }) => (
  <FixedSizeList
    height={600}
    itemCount={lines.length}
    itemSize={80}
    width="100%"
  >
    {({ index, style }) => (
      <div style={style}>
        <DialogueLineItem line={lines[index]} />
      </div>
    )}
  </FixedSizeList>
);
```

---

## Future Enhancements

1. **Advanced Editing**
   - Trim audio clips
   - Adjust volume per line
   - Add fade in/out effects

2. **Timeline View**
   - Visual timeline of all audio
   - Drag to reorder
   - See overlaps and gaps

3. **Collaboration**
   - Real-time collaboration
   - Comments on dialogue lines
   - Approval workflow

4. **Export Options**
   - Export individual tracks
   - Export mixed audio
   - Export subtitles (SRT)

5. **Audio Analysis**
   - Loudness normalization
   - Silence detection
   - Quality scoring

---

## References

- **FILM-502**: Voice Generation Action
- **FILM-503**: Batch Dialogue Action
- **FILM-504**: Music Generation Action
- **FILM-506**: Dialogue List Component
- **FILM-507**: Voice Assignment Component
- **FILM-508**: Audio Player Component
- **Constitution**: Section 8 (Accessibility)
